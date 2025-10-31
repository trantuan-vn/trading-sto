import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { handleError } from '../../../shared/utils.js';

import { 
  ConnectionSchema, 
  PendingMessageSchema, 
  SubscriptionSchema, 
  Connection,
  PendingMessage,
  Subscription,
  BroadcastValidator,
  WebSocketMessageSchema,
  DEFAULT_SCALE_CONFIGS,
  ScaleConfig,
  ScaleConfigName
} from '../domain.js';

const MAX_SEND_FAILURE_COUNT = 3;
const RETRY_ALARM_INTERVAL = 60000;

export class UserDO extends DurableObject {
  // =============================================
  // I. CONSTANTS AND PROPERTIES
  // =============================================
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;
  
  // Table instances
  private connections;
  private pendingMessages;
  private subscriptions;
  private scaleConfig: ScaleConfig = DEFAULT_SCALE_CONFIGS['1M+'];

  private sendFailureCount = new WeakMap<WebSocket, number>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.database = new UserDODatabase(
      this.storage,
      this.getCurrentUserId(),
      this.broadcast.bind(this)
    );
    
    // Initialize tables
    this.connections = this.table('connections', ConnectionSchema, { userScoped: true });
    this.pendingMessages = this.table('pending_messages', PendingMessageSchema, { userScoped: true });
    this.subscriptions = this.table('subscriptions', SubscriptionSchema, { userScoped: true });
  }

  // =============================================
  // II. GETTER METHODS
  // =============================================
  getState(): DurableObjectState {
    return this.state;
  }

  getStorage(): DurableObjectStorage {
    return this.storage;
  }

  getEnv(): Env {
    return this.env;
  }

  getCurrentUserId(): string {
    return this.state.id.toString();
  }

  // =============================================
  // III. DATABASE METHODS
  // =============================================
  getDatabase(): UserDODatabase {
    return this.database;
  }    

  table<T extends z.ZodSchema>(
    name: string,
    schema: T,
    options?: TableOptions
  ) {
    return this.database.table(name, schema, options);
  }

  // =============================================
  // IV. FETCH HANDLER
  // =============================================
  async fetch(request: Request): Promise<Response> {
    try {
      // Handle WebSocket upgrades
      if (request.headers.get('Upgrade') === 'websocket') {
        return await this.handleWebSocketUpgrade(request);
      }

      // Handle internal messages
      const url = new URL(request.url);
      if (url.hostname === 'user.internal') {
        return await this.handleInternalMessage(request);
      }

      // Handle API requests
      switch (url.pathname) {
        case '/status':
          return await this.getWebsocketStatus();
        case '/subscriptions':
          return await this.getSubscriptionList();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (e) {
      handleError(e, "UserDO fetch failed");
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  // =============================================
  // V. INTERNAL MESSAGE HANDLER
  // =============================================
  private async handleInternalMessage(request: Request): Promise<Response> {
    try {
      // Ép kiểu rõ ràng cho dữ liệu JSON
      const message = await request.json() as {
        type: string;
        [key: string]: any;
      };
      
      switch (message.type) {
        case 'broadcast':
          // QUAN TRỌNG: xử lý broadcast ngay lập tức với message data đầy đủ
          await this.handleDirectBroadcastWithMessage(message);
          break;
        case 'heartbeat':
          await this.sendHeartbeat();
          break;
        default:
          return this.createErrorResponse('INVALID_MESSAGE_TYPE', 'Unknown message type');
      }
      
      return new Response(JSON.stringify({ status: 'processed' }));
    } catch (error) {
      return this.createErrorResponse('INTERNAL_ERROR', 'Internal message processing failed');
    }
  }

  // PHƯƠNG THỨC MỚI: Xử lý broadcast trực tiếp với full message
  private async handleDirectBroadcastWithMessage(message: any) {
    const { broadcastId, message: messageContent, timestamp } = message;
    
    try {
      console.log(`📨 UserDO ${this.getCurrentUserId()} received broadcast: ${broadcastId}`);
      
      // Gửi ngay lập tức qua WebSocket - KHÔNG CẦN GỌI NGƯỢC SERVICE
      await this.broadcast("broadcast", messageContent);
      
      // Ghi nhận delivery local (không blocking)
      this.state.waitUntil(this.recordLocalDelivery(broadcastId));
      
    } catch (error) {
      console.error(`Direct broadcast with message failed for ${broadcastId}:`, error);
    }
  }

  // PHƯƠNG THỨC MỚI: Ghi nhận delivery local
  private async recordLocalDelivery(broadcastId: string) {
    // Đơn giản chỉ tăng counter local - báo cáo batch sau
    const current = await this.storage.get<number>(`user_delivery_${broadcastId}`) || 0;
    await this.storage.put(`user_delivery_${broadcastId}`, current + 1);

    // Báo cáo delivery count định kỳ (mỗi 10 delivery hoặc sau 30 giây)
    const newCount = current + 1;
    if (newCount % 10 === 0) {
      this.state.waitUntil(this.reportDeliveryToShard(broadcastId, newCount));
    }
  }

  // PHƯƠNG THỨC MỚI: Báo cáo delivery count về shard
  private async reportDeliveryToShard(broadcastId: string, deliveredCount: number) {
    try {
      const shardName = this.getShardForUser(this.getCurrentUserId());
      const shardDO = this.env.USER_SHARD_DO.get(
        this.env.USER_SHARD_DO.idFromName(shardName)
      );
      
      await shardDO.fetch('https://shard.internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'user_delivery_report',
          broadcastId,
          deliveredCount,
          userId: this.getCurrentUserId(),
          timestamp: Date.now()
        })
      });
      
      // Reset counter sau khi báo cáo
      await this.storage.delete(`user_delivery_${broadcastId}`);
      
    } catch (error) {
      console.warn(`Failed to report delivery to shard for broadcast ${broadcastId}:`, error);
    }
  }

  // PHƯƠNG THỨC MỚI: Lấy shard name cho user
  private getShardForUser(userId: string): string {
    const hash = this.consistentHash(userId, this.scaleConfig.SHARD_COUNT);
    return `shard-${hash}`;
  }


  // PHƯƠNG THỨC MỚI: Consistent hash
  private consistentHash(str: string, buckets: number): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % buckets;
  }

  // =============================================
  // VI. WEBSOCKET HANDLERS
  // =============================================
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    // Store connection info using table
    const connectionData: Connection = ConnectionSchema.parse({
      id: crypto.randomUUID(),
      connected: true,
      lastConnected: Date.now(),
      userAgent: request.headers.get('User-Agent') || undefined,
      ipAddress: request.headers.get('CF-Connecting-IP') || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    await this.connections.create(connectionData);
    
    // Use hibernation API
    this.ctx.acceptWebSocket(server);
    
    // Register user and send pending messages
    this.ctx.waitUntil(Promise.all([
      this.registerUser(),
      this.sendPendingMessages(server)
    ]));

    console.log(`🔌 WebSocket accepted for user ${this.getCurrentUserId()} with hibernation`);

    // Send welcome message
    await this.sendMessage(server, {
      event: 'connected',
      message: 'WebSocket connected to UserDO!',
      timestamp: Date.now(),
      userId: this.getCurrentUserId()
    });

    await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const parsed = WebSocketMessageSchema.parse(JSON.parse(data));
      
      console.log(`Processing message from user ${this.getCurrentUserId()}:`, parsed);
      await this.handleMessage(ws, parsed);
      console.log(`Processed message for user ${this.getCurrentUserId()}:`, parsed);
    } catch (e) {
      handleError(e, `Processing message error: ${message}`);
      await this.sendMessage(ws, { 
        type: 'error', 
        message: 'Invalid message format' 
      });
    }
  }

  private async handleMessage(ws: WebSocket, message: z.infer<typeof WebSocketMessageSchema>) {
    switch (message.type) {
      case 'ping':
        await this.sendMessage(ws, { 
          type: 'pong', 
          timestamp: Date.now() 
        });
        break;
      case 'subscribe':
        if (message.channel) {
          await this.handleSubscribe(message.channel);
          await this.sendMessage(ws, { 
            type: 'subscribed', 
            channel: message.channel 
          });
        }
        break;
      case 'unsubscribe':
        if (message.channel) {
          await this.handleUnsubscribe(message.channel);
          await this.sendMessage(ws, { 
            type: 'unsubscribed', 
            channel: message.channel 
          });
        }
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try {
      console.log(`🔌 UserDO ${this.getCurrentUserId()} WebSocket closed:`, { code, reason, wasClean });
      
      this.sendFailureCount.delete(ws);
      
      // Update connection status using table
      const connections = await this.connections.getAll();
      const activeConnection = connections.find(conn => conn.connected);
      
      if (activeConnection) {
        const updatedConnection: Connection = ConnectionSchema.parse({
          ...activeConnection,
          connected: false,
          updatedAt: Date.now()
        });
        await this.connections.update(activeConnection.id, updatedConnection);
      }
      
      await this.unregisterUser();
      await this.storage.deleteAlarm();
    } catch (e) {
      handleError(e, "UserDO WebSocket closed error");
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    handleError(error, `UserDO ${this.getCurrentUserId()} WebSocket error`);
    try {
      ws.close(1011, 'Internal server error');
    } catch (closeError) {
      handleError(closeError, "Close webSocket error in UserDO WebSocket error");
    }
  }

  // =============================================
  // VII. ALARM HANDLER (chỉ cho heartbeat)
  // =============================================
  async alarm() {
    try {
      await this.handlePeriodicTasks();                        
    } catch (error) {
      handleError(error, "Alarm execution error");
      await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL); 
    }
  }

  private async handlePeriodicTasks(): Promise<void> {
    // Chỉ xử lý heartbeat, không còn xử lý broadcast alarms
    await this.sendHeartbeat();
  }

  private async sendHeartbeat(): Promise<void> {
    const webSockets = this.ctx.getWebSockets();
    if (webSockets.length > 0) {
      this.broadcast('heartbeat', { 
        type: 'periodic',
        activeConnections: webSockets.length,
        timestamp: Date.now()
      });
    }
    await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);
  }

  // =============================================
  // VIII. MESSAGE MANAGEMENT
  // =============================================
  private async sendMessage(ws: WebSocket, message: any): Promise<boolean> {
    try {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket is not open');
      }

      // Validate message using BroadcastValidator
      if (!BroadcastValidator.validateUserId(this.getCurrentUserId())) {
        throw new Error("Invalid user ID");
      }

      const sanitizedMessage = BroadcastValidator.sanitizeBroadcastMessage(message);
      const messageStr = JSON.stringify(sanitizedMessage);
      
      // Check message size
      if (messageStr.length > 1024 * 1024) {
        throw new Error(`Message too large: ${messageStr.length} bytes`);
      }

      ws.send(messageStr);
      
      // Reset failure count on success
      this.sendFailureCount.set(ws, 0);
      
      return true;
      
    } catch (error) {
      await this.handleSendError(ws, error, message);
      return false;
    }
  }

  private async handleSendError(ws: WebSocket, error: any, message: any): Promise<void> {
    const currentFailures = this.sendFailureCount.get(ws) || 0;
    const newFailures = currentFailures + 1;
    this.sendFailureCount.set(ws, newFailures);

    console.error(`Send failed for user ${this.getCurrentUserId()} (attempt ${newFailures}):`, {
      error: error.message,
      messageType: message?.type,
      readyState: ws.readyState
    });

    // Store message for retry (unless it's a validation error)
    if (!error.message.includes("Invalid") && !error.message.includes("too large")) {
      try {
        await this.storePendingMessage(message);
      } catch (e) {
        handleError(e, "Store pending message error");
      }
    }

    // Close connection after MAX_SEND_FAILURE_COUNT consecutive failures
    if (newFailures >= MAX_SEND_FAILURE_COUNT) {
      console.log(`🔒 Closing connection for user ${this.getCurrentUserId()} due to repeated send failures`);
      try {
        ws.close(1011, 'Send failure');
      } catch (closeError) {
        handleError(closeError, "Close webSocket error in Send failure");
      }
    }
  }

  private async storePendingMessage(message: any) {
    const pendingMessages = await this.pendingMessages.getAll();
    
    const pendingMessage: PendingMessage = PendingMessageSchema.parse({
      id: crypto.randomUUID(),
      message: BroadcastValidator.sanitizeBroadcastMessage(message),
      type: message.type || 'unknown',
      priority: 'medium',
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
      scheduledFor: Date.now()
    });

    await this.pendingMessages.create(pendingMessage);
    
    // Keep only last 100 messages - delete oldest if needed
    if (pendingMessages.length >= 100) {
      const oldestMessages = pendingMessages
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, pendingMessages.length - 99);
      
      for (const oldMessage of oldestMessages) {
        await this.pendingMessages.delete(oldMessage.id);
      }
    }
  }

  private async sendPendingMessages(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const pendingMessages = await this.pendingMessages.getAll();
    const successfulSends: PendingMessage[] = [];

    for (const pendingMessage of pendingMessages) {
      if (await this.sendMessage(ws, pendingMessage.message)) {
        successfulSends.push(pendingMessage);
      } else {
        break; // Stop if we can't send
      }
    }

    // Remove successfully sent messages
    for (const sentMessage of successfulSends) {
      await this.pendingMessages.delete(sentMessage.id);
    }
  }

  // =============================================
  // IX. BROADCAST METHODS (legacy - for backward compatibility)
  // =============================================
  protected broadcast(event: string, data: any): void {
    const message = { event, data, timestamp: Date.now() };
    const sanitizedMessage = BroadcastValidator.sanitizeBroadcastMessage(message);

    const webSockets = this.ctx.getWebSockets();
    console.log(`📡 UserDO ${this.getCurrentUserId()} broadcasting to ${webSockets.length} WebSocket clients:`, { event });

    for (const ws of webSockets) {
      this.sendMessage(ws, sanitizedMessage);
    }
  }

  // =============================================
  // X. SUBSCRIPTION MANAGEMENT
  // =============================================
  private async handleSubscribe(channel: string) {
    const existingSubscription = await this.subscriptions
      .where('channel', '==', channel)
      .where('isActive', '==', true)
      .first();

    if (!existingSubscription) {
      const newSubscription: Subscription = SubscriptionSchema.parse({
        id: crypto.randomUUID(),
        channel,
        subscribedAt: Date.now(),
        isActive: true
      });

      await this.subscriptions.create(newSubscription);
    }
  }

  private async handleUnsubscribe(channel: string) {
    const subscription = await this.subscriptions
      .where('channel', '==', channel)
      .where('isActive', '==', true)
      .first();

    if (subscription) {
      await this.subscriptions.update(subscription.id, {
        ...subscription,
        isActive: false
      });
    }
  }

  private async getSubscriptions(): Promise<Subscription[]> {
    try {
      return await this.subscriptions
        .where('isActive', '==', true)
        .get();
    } catch {
      return [];
    }
  }

  // =============================================
  // XI. USER REGISTRATION MANAGEMENT
  // =============================================
  private async registerUser() {
    const userId = this.getCurrentUserId();
    if (!BroadcastValidator.validateUserId(userId)) {
      throw new Error('Invalid user ID for registration');
    }

    const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
      this.env.BROADCAST_SERVICE_DO.idFromName("global")
    );
    await broadcastService.registerUser(userId);
  }

  private async unregisterUser() {
    const userId = this.getCurrentUserId();
    const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
      this.env.BROADCAST_SERVICE_DO.idFromName("global")
    );
    await broadcastService.unregisterUser(userId);
  }

  // =============================================
  // XII. STATUS AND MONITORING
  // =============================================
  async getWebsocketStatus() {
    const [connections, pendingMessages, subscriptions, webSockets] = await Promise.all([
      this.connections.getAll(),
      this.pendingMessages.getAll(),
      this.getSubscriptions(),
      this.ctx.getWebSockets()
    ]);

    const activeConnection = connections.find(conn => conn.connected);

    const status = {
      userId: this.getCurrentUserId(),
      connected: !!activeConnection,
      lastConnected: activeConnection?.lastConnected,
      pendingMessages: pendingMessages.length,
      subscribedChannels: subscriptions.map(sub => sub.channel),
      activeConnections: webSockets.length,
      timestamp: Date.now()
    };

    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getSubscriptionList(): Promise<Response> {
    const subscriptions = await this.getSubscriptions();
    return new Response(JSON.stringify({ subscriptions }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // =============================================
  // XIII. UTILITY METHODS
  // =============================================
  private createErrorResponse(code: string, message: string): Response {
    return new Response(JSON.stringify({
      error: message,
      code,
      timestamp: Date.now()
    }), {
      status: code === 'NOT_FOUND' ? 404 : 
              code === 'VALIDATION_ERROR' ? 400 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}