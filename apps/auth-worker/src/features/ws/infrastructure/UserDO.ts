import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { getIPAndUserAgent, getSessionIdHash, handleErrorWithoutIp } from '../../../shared/utils.js';

import { 
  ConnectionSchema, PendingMessageSchema, SubscriptionSchema, 
  Subscription, WebSocketMessageSchema,
  DEFAULT_SCALE_CONFIGS, ScaleConfig, UserSchema, SessionSchema,
  PricePolicySchema, ServiceSchema, ServiceUsageSchema, VoucherSchema,
  OrderSchema, OrderItemSchema, OrderItemDiscountSchema, ApiTokenSchema,
  PaymentSchema, RefundSchema, BroadcastValidator
} from '../domain.js';

const MAX_SEND_FAILURE_COUNT = 3;
const RETRY_ALARM_INTERVAL = 60000;

export class UserDO extends DurableObject {
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;
  private connections: any;
  private pendingMessages: any;
  private subscriptions: any;
  private scaleConfig: ScaleConfig = DEFAULT_SCALE_CONFIGS['1M+'];
  private sendFailureCount = new WeakMap<WebSocket, number>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.database = new UserDODatabase(this.storage, this.state.id.toString(), this.broadcast.bind(this));
    
    this.state.blockConcurrencyWhile(async () => {
      this.connections = this.table('connections', ConnectionSchema, { userScoped: true });
      this.pendingMessages = this.table('pending_messages', PendingMessageSchema, { userScoped: true });
      this.subscriptions = this.table('subscriptions', SubscriptionSchema, { userScoped: true });
      
      // Initialize common tables
      [PricePolicySchema, ServiceSchema, VoucherSchema].forEach((schema, i) => 
        this.table(['price_policies','services','vouchers'][i], schema));
      // Initialize user tables
      [UserSchema, SessionSchema, 
       ServiceUsageSchema, OrderSchema, OrderItemSchema, OrderItemDiscountSchema, 
       ApiTokenSchema, PaymentSchema, RefundSchema].forEach((schema, i) => 
        this.table(['users','sessions',
                   'service_usages','orders','order_items','order_discounts',
                   'api_tokens','payments','refunds'][i], schema, { userScoped: true }));                   
    });
  }

  // =============================================
  // GETTERS & DATABASE
  // =============================================
  get userId(): string { return this.state.id.toString(); }

  table<T extends z.ZodSchema>(name: string, schema: T, options?: TableOptions) {
    return this.database.table(name, schema, options);
  }

  // =============================================
  // FETCH HANDLER
  // =============================================
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.headers.get('Upgrade') === 'websocket') {
        return await this.handleWebSocketUpgrade(request);
      }

      const url = new URL(request.url);
      if (url.hostname === 'user.internal') {
        return await this.handleInternalMessage(request);
      }

      switch (url.pathname) { 
        case '/status': return await this.getWebsocketStatus(); 
        case '/subscriptions': return await this.getSubscriptionList(); 
        case '/dynamic/insert': return await this.handleDynamicInsert(request);
        case '/dynamic/update': return await this.handleDynamicUpdate(request);
        case '/dynamic/upsert': return await this.handleDynamicUpsert(request);
        case '/dynamic/delete': return await this.handleDynamicDelete(request);
        case '/dynamic/select': return await this.handleDynamicSelect(request);
        case '/dynamic/batch-insert': return await this.handleDynamicBatchInsert(request);
        case '/dynamic/multi-table': return await this.handleDynamicMultiTable(request);
        default: throw new Error(`Unknown path: ${url.pathname}`); 
      }
    } catch (error) {
      handleErrorWithoutIp(error, `UserDO ${this.userId} fetch error`);
      return new Response("Internal Server Error", { status: 500 });
    }        
  }

  // =============================================
  // DYNAMIC OPERATIONS HANDLERS
  // =============================================
  private async handleDynamicInsert(request: Request): Promise<Response> {
    try {
      const { table, data } = await request.json() as { table: string; data: any };
      const result = await this.database.dynamicInsert(table, data);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic insert error for table`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  private async handleDynamicUpdate(request: Request): Promise<Response> {
    try {
      const { table, id, data } = await request.json() as { table: string; id: string; data: any };
      const result = await this.database.dynamicUpdate(table, id, data);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic update error for table`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  private async handleDynamicUpsert(request: Request): Promise<Response> {
    try {
      const { table, data, conflictField } = await request.json() as { 
        table: string; 
        data: any; 
        conflictField?: string 
      };
      const result = await this.database.dynamicUpsert(table, data, conflictField);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic upsert error for table`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  private async handleDynamicDelete(request: Request): Promise<Response> {
    try {
      const { table, id, where } = await request.json() as { 
        table: string; 
        id?: string; 
        where?: { field: string; operator: string; value: any } 
      };
      
      if (id) {
        await this.database.dynamicDelete(table, id);
      } else if (where) {
        await this.database.dynamicDeleteWhere(table, where);
      } else {
        throw new Error('Either id or where condition is required');
      }
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic delete error for table`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  private async handleDynamicSelect(request: Request): Promise<Response> {
    try {
      const { table, where, orderBy, limit } = await request.json() as {
        table: string;
        where?: { field: string; operator: string; value: any };
        orderBy?: { field: string; direction: 'ASC' | 'DESC' };
        limit?: number;
      };
      
      const result = await this.database.dynamicSelect(table, where, orderBy, limit);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic select error for table`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  private async handleDynamicBatchInsert(request: Request): Promise<Response> {
    try {
      const { table, data } = await request.json() as { table: string; data: any[] };
      const result = await this.database.dynamicBatchInsert(table, data);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic batch insert error for table`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  private async handleDynamicMultiTable(request: Request): Promise<Response> {
    try {
      const { operations } = await request.json() as {
        operations: Array<{
          table: string;
          operation: 'insert' | 'update' | 'upsert' | 'delete';
          data?: any;
          id?: string;
          conflictField?: string;
          where?: { field: string; operator: string; value: any };
        }>;
      };
      
      const result = await this.database.dynamicMultiTableTransaction(operations);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleErrorWithoutIp(error, `Dynamic multi-table transaction error`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }), { status: 400 });
    }
  }

  // =============================================
  // INTERNAL MESSAGE HANDLER
  // =============================================
  private async handleInternalMessage(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Repository operations
    if (url.pathname.startsWith('/repository/')) {
      return await this.handleRepositoryOperations(request, url.pathname);
    }

    // Dynamic operations via internal endpoint
    if (url.pathname.startsWith('/dynamic/')) {
      const path = url.pathname.replace('/dynamic', '');
      switch (path) {
        case '/insert': return await this.handleDynamicInsert(request);
        case '/update': return await this.handleDynamicUpdate(request);
        case '/upsert': return await this.handleDynamicUpsert(request);
        case '/delete': return await this.handleDynamicDelete(request);
        case '/select': return await this.handleDynamicSelect(request);
        case '/batch-insert': return await this.handleDynamicBatchInsert(request);
        case '/multi-table': return await this.handleDynamicMultiTable(request);
      }
    }

    const message = await request.json() as { type: string; [key: string]: any };
    if (message.type === 'broadcast') {
      await this.handleDirectBroadcast(message);
    }
    
    return new Response(JSON.stringify({ status: 'processed' }));
  }

  private async handleRepositoryOperations(request: Request, path: string): Promise<Response> {
    const data = await request.json() as any
    
    switch (path) {
      case '/repository/transaction':
        await this.database.execTransaction(data.operations);
        return new Response('OK');
        
      case '/repository/select':
        const result = await this.database.execSelectSQL(data.sql, data.params || []);
        return new Response(JSON.stringify(result), { 
          headers: { 'Content-Type': 'application/json' } 
        });
        
      case '/repository/action':
        return await this.handleRepositoryAction(data);
        
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  private async handleRepositoryAction(data: any): Promise<Response> {
    const { table, operation, data: opData } = data;
    const tableInstance = this.database.getTable(table);
    if (!tableInstance) return new Response(`Table ${table} not found`, { status: 404 });

    const operations: { [key: string]: Function } = {
      getUserId: () => this.state.id.toString(),
      getAll: () => tableInstance.getAll(),
      insert: () => tableInstance.create(opData),
      update: () => tableInstance.update(opData.id, opData),
      delete: () => tableInstance.delete(opData.id),
      create: () => tableInstance.create(opData),
      findById: () => tableInstance.findById(opData.id),
      count: () => tableInstance.count(),
      where: () => tableInstance.where(opData.path, opData.operator, opData.value).get(),
      orderBy: () => tableInstance.orderBy(opData.field, opData.direction).get(),
      limit: () => tableInstance.limit(opData.count).get(),
      first: () => tableInstance.limit(1).first(),
      broadcast: () => { 
        tableInstance.broadcastToUser(opData.event, opData.broadcastData);  
        return { success: true, message: 'Broadcast sent' };
      }
    };

    if (!operations[operation]) {
      return new Response(`Invalid operation: ${operation}`, { status: 400 });
    }

    const result = await operations[operation]();
    return new Response(JSON.stringify(result));
  }

  // =============================================
  // BROADCAST HANDLING
  // =============================================
  private async handleDirectBroadcast(message: any) {
    const { broadcastId, message: messageContent } = message;
    await this.broadcast("broadcast", messageContent);
    this.state.waitUntil(this.recordLocalDelivery(broadcastId));      
  }

  private async recordLocalDelivery(broadcastId: string) {
    const current = await this.storage.get<number>(`user_delivery_${broadcastId}`) || 0;
    const newCount = current + 1;
    await this.storage.put(`user_delivery_${broadcastId}`, newCount);

    if (newCount % 10 === 0) {
      this.state.waitUntil(this.reportDeliveryToShard(broadcastId, newCount));
    }
  }

  private async reportDeliveryToShard(broadcastId: string, deliveredCount: number) {
    const shardName = this.getShardForUser(this.userId);
    const shardDO = this.env.USER_SHARD_DO.get(this.env.USER_SHARD_DO.idFromName(shardName));
    
    await shardDO.fetch('https://shard.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'user_delivery_report',
        broadcastId, deliveredCount, userId: this.userId, timestamp: Date.now()
      })
    });
    
    await this.storage.delete(`user_delivery_${broadcastId}`);    
  }

  private getShardForUser(userId: string): string {
    const hash = this.consistentHash(userId, this.scaleConfig.SHARD_COUNT);
    return `shard-${hash}`;
  }

  private consistentHash(str: string, buckets: number): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % buckets;
  }

  // =============================================
  // WEBSOCKET HANDLERS
  // =============================================
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const { ipAddress, userAgent } = getIPAndUserAgent(request);
    if (!ipAddress || !userAgent) throw new Error('Missing IP or user agent');
    
    const sessionId = getSessionIdHash(ipAddress, userAgent, this.env.ENCRYPTION_SECRET);
    await this.connections.create(ConnectionSchema.parse({
      connected: true, lastConnected: Date.now(), sessionId
    }));

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    this.ctx.acceptWebSocket(server);
    this.ctx.waitUntil(Promise.all([this.registerUser(), this.sendPendingMessages(server)]));

    await this.sendMessage(server, {
      event: 'connected', message: 'WebSocket connected to UserDO!',
      timestamp: Date.now(), userId: this.userId
    });

    await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const parsed = WebSocketMessageSchema.parse(JSON.parse(data));
      await this.handleMessage(ws, parsed);
    } catch (e) {
      handleErrorWithoutIp(e, `Processing message error, the message is : ${message}`);
      await this.sendMessage(ws, { type: 'error', message: 'Invalid message format' });
    }
  }

  private async handleMessage(ws: WebSocket, message: z.infer<typeof WebSocketMessageSchema>) {
    const responses: { [key: string]: Function } = {
      ping: () => this.sendMessage(ws, { type: 'pong', timestamp: Date.now() }),
      subscribe: async () => {
        if (message.channel) {
          await this.handleSubscribe(message.channel);
          await this.sendMessage(ws, { type: 'subscribed', channel: message.channel });
        }
      },
      unsubscribe: async () => {
        if (message.channel) {
          await this.handleUnsubscribe(message.channel);
          await this.sendMessage(ws, { type: 'unsubscribed', channel: message.channel });
        }
      }
    };

    if (responses[message.type]) await responses[message.type]();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try {
      this.sendFailureCount.delete(ws);
      const connections = await this.connections.getAll();
      const activeConnection = connections.find((conn: any) => conn.connected);
      
      if (activeConnection) {
        await this.connections.update(activeConnection.id, {
          ...activeConnection, connected: false, updatedAt: Date.now()
        });
      }
      
      await this.unregisterUser();
      await this.storage.deleteAlarm();
    } catch (e) {
      handleErrorWithoutIp(e, "UserDO WebSocket closed error");
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    handleErrorWithoutIp(error, `UserDO ${this.userId} WebSocket error`);
    try { ws.close(1011, 'Internal server error'); } 
    catch (closeError) { handleErrorWithoutIp(closeError, "Close webSocket error"); }
  }

  // =============================================
  // ALARM & MESSAGE MANAGEMENT
  // =============================================
  async alarm() {
    try { await this.sendHeartbeat(); } 
    catch (error) { handleErrorWithoutIp(error, "Alarm execution error"); }
    
    if (this.ctx.getWebSockets().length > 0) {
      await this.storage.setAlarm(Date.now() + RETRY_ALARM_INTERVAL);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const webSockets = this.ctx.getWebSockets();
    this.broadcast('heartbeat', { 
      type: 'periodic', activeConnections: webSockets.length, timestamp: Date.now()
    });
  }

  private async sendMessage(ws: WebSocket, message: any): Promise<boolean> {
    try {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
      
      const messageStr = JSON.stringify(message);
      if (messageStr.length > 1024 * 1024) throw new Error(`Message too large: ${messageStr.length} bytes`);

      ws.send(messageStr);
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

    if (!error.message.includes("Invalid") && !error.message.includes("too large")) {
      try { await this.storePendingMessage(message); } 
      catch (e) { handleErrorWithoutIp(e, `Store pending message error, the message is : ${message}`); }
    }

    if (newFailures >= MAX_SEND_FAILURE_COUNT) {
      try { ws.close(1011, 'Send failure'); } 
      catch (closeError) { handleErrorWithoutIp(closeError, "Close webSocket error"); }
    }
  }

  private async storePendingMessage(message: any) {
    await this.pendingMessages.create(PendingMessageSchema.parse({
      message: BroadcastValidator.sanitizeBroadcastMessage(message),
      type: message.type || 'unknown', priority: 'medium',
      attempts: 0, maxAttempts: 3, scheduledFor: Date.now()
    }));
  }

  private async sendPendingMessages(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    
    const pendingMessages = await this.pendingMessages.getAll();
    const successfulSends: any[] = [];

    for (const pendingMessage of pendingMessages) {
      if (await this.sendMessage(ws, pendingMessage.message)) {
        successfulSends.push(pendingMessage);
      } else break;
    }

    for (const sentMessage of successfulSends) {
      await this.pendingMessages.delete(sentMessage.id);
    }
  }

  // =============================================
  // BROADCAST & SUBSCRIPTION MANAGEMENT
  // =============================================
  protected broadcast(event: string, data: any): void {
    const message = { event, data, timestamp: Date.now() };
    this.ctx.getWebSockets().forEach(ws => this.sendMessage(ws, message));
  }

  private async handleSubscribe(channel: string) {
    const existing = await this.subscriptions
      .where('channel', '==', channel)
      .where('isActive', '==', true)
      .first();

    if (!existing) {
      await this.subscriptions.create(SubscriptionSchema.parse({
        channel: channel, subscribedAt: Date.now(), isActive: true
      }));
    }
  }

  private async handleUnsubscribe(channel: string) {
    const subscription = await this.subscriptions
      .where('channel', '==', channel)
      .where('isActive', '==', true)
      .first();

    if (subscription) {
      await this.subscriptions.update(subscription.id, {
        ...subscription, isActive: false
      });
    }
  }

  private async getSubscriptions(): Promise<Subscription[]> {
    try {
      return await this.subscriptions.where('isActive', '==', true).get();
    } catch { return []; }
  }

  // =============================================
  // USER REGISTRATION & STATUS
  // =============================================
  private async registerUser() {
    const broadcastDO = this.env.BROADCAST_SERVICE_DO.get(
      this.env.BROADCAST_SERVICE_DO.idFromName("global")
    );

    const response = await broadcastDO.fetch('https://broadcast.internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'registerUser', userId: this.userId })
    });
    
    if (!response.ok) throw new Error(`Failed to register user: ${response.statusText}`);
  }

  private async unregisterUser() {
    const broadcastDO = this.env.BROADCAST_SERVICE_DO.get(
      this.env.BROADCAST_SERVICE_DO.idFromName("global")
    );

    const response = await broadcastDO.fetch('https://broadcast.internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unregisterUser', userId: this.userId })
    });
    
    if (!response.ok) throw new Error(`Failed to unregister user: ${response.statusText}`);
  }

  async getWebsocketStatus() {
    const [connections, pendingMessages, subscriptions, webSockets] = await Promise.all([
      this.connections.getAll(), this.pendingMessages.getAll(), 
      this.getSubscriptions(), this.ctx.getWebSockets()
    ]);

    const activeConnection = connections.find((conn: any) => conn.connected);
    const status = {
      userId: this.userId, connected: !!activeConnection,
      lastConnected: activeConnection?.lastConnected,
      pendingMessages: pendingMessages.length,
      subscribedChannels: subscriptions.map(sub => sub.channel),
      activeConnections: webSockets.length, timestamp: Date.now()
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
}