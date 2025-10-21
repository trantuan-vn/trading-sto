import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { UserDODatabase, TableOptions } from '../database/index.js';

export class UserDO extends DurableObject {
    protected state: DurableObjectState;
    protected storage: DurableObjectStorage;
    protected env: Env;
    protected database: UserDODatabase;

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
    }

    // I. GETTER
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
    // II. TABLE
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

    // III. FETCH
    async fetch(request: Request): Promise<Response> {
        // Handle WebSocket upgrades directly in the UserDO
        if (request.headers.get('Upgrade') === 'websocket') {
            const webSocketPair = new WebSocketPair();
            const [client, server] = Object.values(webSocketPair);
            // Store connection info
            await this.storage.put('connected', true);
            await this.storage.put('lastConnected', Date.now());
            // Use hibernation API - this makes the WebSocket hibernatable
            this.ctx.acceptWebSocket(server);
            // Register this user when DO is created
            this.state.waitUntil(this.registerUser());        
            // Send any pending messages
            this.state.waitUntil(this.sendPendingMessages(server));

            console.log('🔌 WebSocket accepted by UserDO with hibernation');

            // Send welcome message
            server.send(JSON.stringify({
                event: 'connected',
                message: 'WebSocket connected to UserDO!',
                timestamp: Date.now()
            }));

            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        }

        // Handle other requests normally
        return new Response('Not Found', { status: 404 });
    }  

    private async registerUser() {
        const userId = this.state.id.toString();
        const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
            this.env.BROADCAST_SERVICE_DO.idFromName("global")
        );
        await broadcastService.registerUser(userId);
    }

    // IV. WEBSOCKET STATUS 
    async getStatus() {
        const connected = await this.storage.get('connected');
        const lastConnected = await this.storage.get('lastConnected');
        let pendingMessages: any[] = [];
        try {
            pendingMessages = JSON.parse(await this.storage.get('pendingMessages') || '[]');
        } catch (e) {
            console.error('Failed to parse pendingMessages:', e);
        }

        return new Response(JSON.stringify({
            userId: this.state.id.toString(),
            connected: !!connected,
            lastConnected,
            pendingMessages: pendingMessages.length
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }    

    // V. WEBSOCKET HANDLER
    // WebSocket message handler (called by runtime when hibernated)
    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        try {
            const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
            const parsed = JSON.parse(data);
            console.log('📨 UserDO WebSocket message received:', message);
            await this.handleMessage(ws, parsed); // Await để xử lý async
            // Echo back
            ws.send(JSON.stringify({
                event: 'echo',
                original: parsed,
                message: 'Message received by UserDO',
                timestamp: Date.now()
            }));
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    }
    private async handleMessage(ws: WebSocket, message: any) {
        try {
            // Handle different message types
            switch (message.type) {
                case 'ping':
                    await this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
                    break;
                case 'subscribe':
                    await this.handleSubscribe(message.channel);
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Message handling error:', error);
        }
    }  
    private async handleSubscribe(channel: string) {
        await this.storage.put('subscribedChannel', channel);
    }  

    private async sendMessage(ws: WebSocket, message: any) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error('Failed to send message to WebSocket:', error);
                await this.storage.put('connected', false);
                return false;
            }
        } else {
            // Store message for when user reconnects
            await this.storePendingMessage(message);
            return false;
        }
    }
    private async storePendingMessage(message: any) {
        let pending: any[] = [];
        try {
            pending = JSON.parse(await this.storage.get('pendingMessages') || '[]');
        } catch (e) {
            console.error('Failed to parse pendingMessages for store:', e);
        }
        pending.push({
            message,
            timestamp: Date.now()
        });
        // Keep only last 100 messages
        if (pending.length > 100) {
            pending.shift(); // Tối ưu: shift thay vì splice để giữ last 100
        }
        await this.storage.put('pendingMessages', JSON.stringify(pending));
    }    
    private async sendPendingMessages(ws: WebSocket) {
        if (ws.readyState !== WebSocket.OPEN) return; // Sửa logic: Không return nếu OPEN, mà tiếp tục

        let pending: any[] = [];
        try {
            pending = JSON.parse(await this.storage.get('pendingMessages') || '[]');
        } catch (e) {
            console.error('Failed to parse pendingMessages for send:', e);
            return;
        }
        const successfulSends = [];

        for (const item of pending) {
            if (await this.sendMessage(ws, item.message)) {
                successfulSends.push(item);
            } else {
                break; // Stop if we can't send
            }
        }
        // Remove successfully sent messages
        if (successfulSends.length > 0) {
            const remaining = pending.slice(successfulSends.length);
            await this.storage.put('pendingMessages', JSON.stringify(remaining));
        }
    }    
    // VI. WEBSOCKET CLEANUP
    // WebSocket close handler (called by runtime when hibernated)
    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        console.log('🔌 UserDO WebSocket closed:', { code, reason, wasClean });
        // Store connection info
        await this.storage.put('connected', false);
        // Clean up WebSocket resources if needed
        await this.cleanupWebSocketResources(ws);
    }
    private async cleanupWebSocketResources(ws: WebSocket): Promise<void> {
        // Clean up any resources associated with this WebSocket
        // Remove inactive user
        await this.unregisterUser();

        console.log('🧹 Cleaning up WebSocket resources');
    }    
     
    private async unregisterUser() {
        const userId = this.state.id.toString();
        const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
            this.env.BROADCAST_SERVICE_DO.idFromName("global")
        );
        await broadcastService.unregisterUser(userId);
    }
    // VII. WEBSOCKET ERROR
    // WebSocket error handler (called by runtime when hibernated)
    async webSocketError(ws: WebSocket, error: unknown) {
        console.error('❌ UserDO WebSocket error:', error);
        
        // Log the error for monitoring
        this.logWebSocketError(error, ws);
        
        // Optionally close the WebSocket on error
        try {
            ws.close(1011, 'Internal server error'); // 1011: Internal Error
        } catch (closeError) {
            console.error('Error closing WebSocket after error:', closeError);
        }
    }
    private logWebSocketError(error: unknown, ws: WebSocket): void {
        // Log WebSocket errors for monitoring and debugging
        const errorInfo = {
            userId: this.getCurrentUserId(),
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now()
        };
        
        console.error('WebSocket Error Log:', errorInfo);
        
        // Could also send to external monitoring service
        // await this.sendToMonitoringService(errorInfo);
    }    
    // VIII. ALARM
    // Alarm handler - called when the scheduled alarm triggers
    async alarm() {
        console.log('⏰ UserDO Alarm triggered at:', new Date().toISOString());
        
        try {
            // Perform periodic tasks
            await this.handlePeriodicTasks();                        
        } catch (error) {
            console.error('Alarm execution error:', error);            
            // Reschedule alarm on error to ensure it runs again
            await this.storage.setAlarm(Date.now() + 60000); // Retry in 1 minute
        }
    }
    async setAlarm(time: number, broadcastId: string) {
        const alarmData = broadcastId ? JSON.stringify({ broadcastId }) : null;
        // lưu data để dùng sau
        await this.storage.put("alarmData", alarmData);
        await this.storage.setAlarm(time);
    }    

    private async handlePeriodicTasks(): Promise<void> {
        // Implement periodic tasks like:
        // - Sending heartbeat to connected clients
        // - Cleaning up old data
        // - Syncing state with external services
        let data: any = await this.storage.get("alarmData");
        try {
            let parsedData: { broadcastId?: string } = {};
            if (typeof data === 'string') {
                parsedData = JSON.parse(data);
            } else if (data) {
                parsedData = data;
            }
            
            if (parsedData.broadcastId) {
                await this.fetchAndSendBroadcast(parsedData.broadcastId);
            } else {
                // Regular alarm for maintenance
                await this.unregisterUser();
            }
        } catch (error) {
            console.error('Alarm error:', error);
        }        

        const webSockets = this.ctx.getWebSockets();
        if (webSockets.length > 0) {
            this.broadcast('heartbeat', { 
                type: 'periodic',
                activeConnections: webSockets.length,
                timestamp: Date.now()
            });
        }
    }   
    private async fetchAndSendBroadcast(broadcastId: string) {
        try {
        // Get broadcast message from broadcast service
        const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
            this.env.BROADCAST_SERVICE_DO.idFromName("global")
        );
        
        const broadcastData = await broadcastService.getBroadcastData(broadcastId) as any;
        
        if (broadcastData && broadcastData.message) {
            await this.broadcast("broadcast", broadcastData.message);
            // Notify broadcast service of delivery
            await this.notifyDelivery(broadcastId);
        }
        } catch (error) {
            console.error('Failed to fetch broadcast:', error);
        }
    }    
    private async notifyDelivery(broadcastId: string) {
        try {
            const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
                this.env.BROADCAST_SERVICE_DO.idFromName("global")
            );
            // This would need to be implemented in BroadcastService
            await broadcastService.recordDelivery(broadcastId);
        } catch (error) {
            console.error('Failed to notify delivery:', error);
        }
    }    

    // Broadcast to all connected WebSocket clients using hibernation API
    protected broadcast(event: string, data: any): void {
        const message = JSON.stringify({ event, data, timestamp: Date.now() });

        // Use hibernation API to get all connected WebSockets
        const webSockets = this.ctx.getWebSockets();

        console.log(`📡 UserDO Broadcasting to ${webSockets.length} WebSocket clients:`, { event, data });

        for (const ws of webSockets) {
            try {
                ws.send(message);
            } catch (error) {
                console.error('Broadcast error:', error);
                // Remove problematic WebSocket if needed
                this.handleBroadcastError(ws, error);
            }
        }
    }
    private handleBroadcastError(ws: WebSocket, error: unknown): void {
        // Handle broadcast errors by potentially closing the problematic connection
        console.error('Handling broadcast error for WebSocket:', error);
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1011, 'Broadcast error');
            }
        } catch (closeError) {
            console.error('Error closing problematic WebSocket:', closeError);
        }
    }
}