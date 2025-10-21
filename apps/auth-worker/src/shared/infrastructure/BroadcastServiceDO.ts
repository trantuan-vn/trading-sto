import { DurableObject } from 'cloudflare:workers';

// broadcast-service.js
export class BroadcastServiceDO  extends DurableObject {
    protected state: DurableObjectState;
    protected storage: DurableObjectStorage;
    protected env: Env;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.storage = state.storage;

        // Initialize if needed
        this.state.blockConcurrencyWhile(async () => {
            await this.initialize();
        });
    }

    private async initialize() {
        // Initialize counters and indexes
        const initialized = await this.storage.get('initialized');
        if (!initialized) {
            await this.storage.put('totalUsers', 0);
            await this.storage.put('userShards', JSON.stringify([]));
            await this.storage.put('initialized', true);
        }
    }
    // I. BROADCAST
    async broadcast(message: string) {
        const broadcastId = `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store the broadcast message
        await this.storage.put(`broadcast:${broadcastId}`, JSON.stringify({
            message,
            timestamp: Date.now(),
            status: 'pending',
            delivered: 0,
            total: 0
        }));

        // Trigger broadcast process
        this.state.waitUntil(this.processBroadcast(broadcastId));
        
        return new Response(JSON.stringify({
            broadcastId,
            status: 'started'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    async getBroadcastData(broadcastId: string) {
        return await this.storage.get(`broadcast:${broadcastId}`);
    }

    private async processBroadcast(broadcastId: string) {
        try {
            // Get broadcast data
            let broadcastDataStr = await this.storage.get(`broadcast:${broadcastId}`);
            if (!broadcastDataStr) {
                throw new Error(`Broadcast ${broadcastId} not found`);
            }
            let broadcastData;
            try {
                const jsonStr = typeof broadcastDataStr === 'string' ? broadcastDataStr : '[]';
                broadcastData = JSON.parse(jsonStr);
            } catch (e) {
                throw new Error(`Invalid broadcast data for ${broadcastId}`);
            }

            // Update status to processing
            broadcastData.status = 'processing';
            await this.storage.put(`broadcast:${broadcastId}`, JSON.stringify(broadcastData));

            // Get all user shards
            let userShardsStr = await this.storage.get('userShards');
            let userShards: string[] = [];
            try {
                const jsonStr = typeof userShardsStr === 'string' ? userShardsStr : '[]';
                userShards = JSON.parse(jsonStr);                
            } catch (e) {
                console.error('Failed to parse userShards:', e);
            }
            const totalUsers = (await this.storage.get<number>('totalUsers')) ?? 0;

            // Update total users count
            broadcastData.total = totalUsers;
            await this.storage.put(`broadcast:${broadcastId}`, JSON.stringify(broadcastData));

            // Trigger broadcast to each shard
            const shardPromises = userShards.map((shardName: string) => 
                this.triggerShardBroadcast(shardName, broadcastId)
            );

            await Promise.allSettled(shardPromises);

            // Mark as completed
            broadcastData.status = 'completed';
            await this.storage.put(`broadcast:${broadcastId}`, JSON.stringify(broadcastData));

        } catch (error) {
            console.error('Broadcast processing error:', error);
            //await this.storage.put(`broadcast:${broadcastId}:error`, error.message);
        }
    }

    private async triggerShardBroadcast(shardName: string, broadcastId: string) {
        try {
            const shardDO = this.env.USER_SHARD_DO.get(
                this.env.USER_SHARD_DO.idFromName(shardName)
            );
            await shardDO.triggerBroadcast(broadcastId);
        } catch (error) {
            console.error(`Shard ${shardName} error:`, error);
        }
    }

    // II. USERS
    async registerUser(userId: string) {
        // Sử dụng transaction để tránh race
        await this.storage.transaction(async (txn) => {
            const shardName = this.getShardForUser(userId);
            
            // Register user in shard
            const shardDO = this.env.USER_SHARD_DO.get(
                this.env.USER_SHARD_DO.idFromName(shardName)
            );
            await shardDO.registerUser(userId);

            // Update global counters
            const totalUsers = (await txn.get<number>('totalUsers')) ?? 0;
            await txn.put('totalUsers', totalUsers + 1);
                    
            let userShardsStr = await txn.get('userShards');
            let userShards: string[] = [];
            try {
                const jsonStr = typeof userShardsStr === 'string' ? userShardsStr : '[]';
                userShards = JSON.parse(jsonStr);                
            } catch (e) {}
            if (!userShards.includes(shardName)) {
                userShards.push(shardName);
                await txn.put('userShards', JSON.stringify(userShards));
            }
        });
    }

    async unregisterUser(userId: string) {
        await this.storage.transaction(async (txn) => {
            const shardName = this.getShardForUser(userId);
            const shardDO = this.env.USER_SHARD_DO.get(
                this.env.USER_SHARD_DO.idFromName(shardName)
            );
            await shardDO.unregisterUser(userId);
            // Update global counters
            const totalUsers = (await txn.get<number>('totalUsers')) ?? 1;
            await txn.put('totalUsers', Math.max(0, totalUsers - 1)); // Ngăn âm
        });
    }

    private getShardForUser(userId: string) {
        // Simple sharding based on user ID hash
        const shardCount = 100; // Adjust based on scale
        const hash = this.hashString(userId);
        return `shard-${hash % shardCount}`;
    }

    private hashString(str: string) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }
    
    // III. DELIVERY
    async recordDelivery(broadcastId: string, userId = null) {
        try {
            // Sử dụng transaction để tránh race conditions
            await this.state.storage.transaction(async (txn) => {
                const dataStr = await this.getBroadcastData(broadcastId); // Await đúng
                if (!dataStr) {
                    console.warn(`Broadcast ${broadcastId} not found for delivery recording`);
                    return;
                }
                let data;
                try {
                    const jsonStr = typeof dataStr === 'string' ? dataStr : '[]';
                    data = JSON.parse(jsonStr);
                } catch (e) {
                    console.error('Failed to parse broadcast data:', e);
                    return;
                }

                data.delivered = (data.delivered || 0) + 1;
                
                // Cập nhật delivery timestamp cho user cụ thể (nếu có)
                if (userId) {
                    await txn.put(`delivery:${broadcastId}:${userId}`, Date.now());
                    // Track user delivery stats
                    await this.updateUserDeliveryStats(userId, txn);
                }

                // Cập nhật real-time delivery rate
                await this.updateDeliveryRate(data, txn);

                await txn.put(`broadcast:${broadcastId}`, JSON.stringify(data));
            });

            // Log delivery progress mỗi 1000 deliveries
            const broadcastDataStr = await this.storage.get(`broadcast:${broadcastId}`);
            let broadcastData;
            try {
                const jsonStr = typeof broadcastDataStr === 'string' ? broadcastDataStr : '{}';
                broadcastData = JSON.parse(jsonStr);                
            } catch (e) {}
            if (broadcastData.delivered % 1000 === 0) {
                console.log(`Broadcast ${broadcastId}: ${broadcastData.delivered}/${broadcastData.total} delivered`);
            }

        } catch (error) {
            console.error('Delivery recording error:', error);
            
            // Fallback: retry without transaction
            try {
                const dataStr = await this.getBroadcastData(broadcastId);
                if (dataStr) {
                    const jsonStr = typeof dataStr === 'string' ? dataStr : '{}';
                    let data = JSON.parse(jsonStr);
                    data.delivered = (data.delivered || 0) + 1;
                    await this.storage.put(`broadcast:${broadcastId}`, JSON.stringify(data));
                }
            } catch (fallbackError) {
                console.error('Fallback delivery recording also failed:', fallbackError);
            }
        }
    } 
    private async updateUserDeliveryStats(userId: string, txn: DurableObjectTransaction) {
        const userStatsKey = `user_stats:${userId}`;
        let userStatsStr = await txn.get(userStatsKey);
        const jsonStr = typeof userStatsStr === 'string' ? userStatsStr : '{}';
        const userStats = JSON.parse(jsonStr);                                
        userStats.totalDeliveries = (userStats.totalDeliveries || 0) + 1;
        userStats.lastDelivery = Date.now();
        userStats.updatedAt = Date.now();
        
        await txn.put(userStatsKey, JSON.stringify(userStats));
    }

    private async updateDeliveryRate(broadcastData: any, txn: DurableObjectTransaction) {
        const elapsed = Date.now() - broadcastData.timestamp;
        const rate = elapsed > 0 ? (broadcastData.delivered / elapsed) * 1000 : 0; // deliveries per second
        
        await txn.put(`delivery_rate:${broadcastData.timestamp}`, Math.round(rate));
        
        // Cleanup old delivery rates (keep only last 24 hours)
        await this.cleanupOldDeliveryRates(txn);
    }

    private async cleanupOldDeliveryRates(txn: DurableObjectTransaction) {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const rates = await txn.list({ prefix: 'delivery_rate:' });
        
        for (const key of rates.keys()) {
            const timestamp = parseInt(key.split(':')[1]);
            if (timestamp < oneDayAgo) {
                await txn.delete(key);
            }
        }
    }

    // IV. ANALYTICS
    async getBroadcastAnalytics(broadcastId: string) {
        const stats = await this.getDeliveryStats(broadcastId);
        if (!stats) return null;

        // Tính estimated completion time
        const remaining = stats.pending;
        const rate = stats.deliveryRate;
        const estimatedCompletion = rate > 0 ? 
        Math.round(remaining / rate) : null;

        return {
        ...stats,
        estimatedCompletionSeconds: estimatedCompletion,
        estimatedCompletionTime: estimatedCompletion ? 
            new Date(Date.now() + estimatedCompletion * 1000).toISOString() : null,
        status: stats.completionPercentage === 100 ? 'completed' : 
                stats.deliveryRate > 0 ? 'in_progress' : 'stalled'
        };
    }           
    private async getDeliveryStats(broadcastId: string) {
        const dataStr = await this.storage.get(`broadcast:${broadcastId}`);
        if (!dataStr) return null;
        let data;
        try {
            const jsonStr = typeof dataStr === 'string' ? dataStr : '[]';
            data = JSON.parse(jsonStr);
        } catch (e) {
            return null;
        }
        
        // Tính delivery rate
        const elapsed = Date.now() - data.timestamp;
        const rate = elapsed > 0 ? (data.delivered / elapsed) * 1000 : 0;
        
        // Lấy danh sách user deliveries (mẫu)
        const deliveries = await this.storage.list({ 
            prefix: `delivery:${broadcastId}:`,
            limit: 100 
        });

        return {
            broadcastId,
            totalUsers: data.total,
            delivered: data.delivered,
            pending: Math.max(0, data.total - data.delivered),
            deliveryRate: Math.round(rate * 100) / 100, // deliveries per second
            completionPercentage: data.total > 0 ? 
                Math.round((data.delivered / data.total) * 100) : 0,
            sampleDeliveries: Array.from(deliveries.entries()).slice(0, 10).map(([key, timestamp]) => ({
                userId: key.split(':')[2],
                deliveredAt: new Date(Number(timestamp)).toISOString()
            }))
        };
    }

}