// broadcast-service-do.ts
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { 
  ScaleConfig, 
  ServiceConfigSchema,
  ScaleConfigName, 
  BroadcastData, 
  BroadcastDataSchema, 
  CreateBroadcast, 
  DeliveryRecord, 
  DeliveryRecordSchema, 
  BroadcastAnalytics, 
  DeliveryStats,
  BroadcastResponse,
  ScaleConfigResponse,
  ErrorResponse,
  DEFAULT_SCALE_CONFIGS, 
  DEFAULT_SERVICE_CONFIG,
  BroadcastValidator,
  UserShardSchema,
  GlobalCounterSchema
} from '../domain';

import { handleError } from '../../../shared/utils';


export class BroadcastServiceDO extends DurableObject {
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;
  
  // Table instances
  private broadcasts;
  private deliveryRecords;
  private serviceConfigs;
  private userShards;
  private globalCounters;
  
  private scaleConfig: ScaleConfig = DEFAULT_SCALE_CONFIGS['1M+'];
  private scaleConfigName: ScaleConfigName = '1M+';

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.storage = state.storage;

    this.database = new UserDODatabase(
      this.storage,
      this.getCurrentUserId()
    );
    
    // Initialize tables with extracted schemas
    this.broadcasts = this.table('broadcasts', BroadcastDataSchema);
    this.deliveryRecords = this.table('delivery_records', DeliveryRecordSchema);
    this.serviceConfigs = this.table('service_configs', ServiceConfigSchema);
    this.userShards = this.table('user_shards', UserShardSchema);
    this.globalCounters = this.table('global_counters', GlobalCounterSchema);

    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }

  // =============================================
  // I. GETTER METHODS
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

  table<T extends z.ZodSchema>(
    name: string,
    schema: T,
    options?: TableOptions
  ) {
    return this.database.table(name, schema, options);
  }

  private async initialize() {
    const initialized = await this.globalCounters.where('key', '==', 'initialized').first();
    if (!initialized) {
      // Initialize global counters
      await this.globalCounters.create({
        key: 'totalUsers',
        value: 0,
        updatedAt: Date.now()
      });
      
      await this.globalCounters.create({
        key: 'initialized',
        value: 1,
        updatedAt: Date.now()
      });
      
      await this.globalCounters.create({
        key: 'scaleConfig',
        value: '1M+', 
        updatedAt: Date.now()
      });

      // Initialize service config
      await this.serviceConfigs.create({
        ...DEFAULT_SERVICE_CONFIG
      });
    }
    
    // Load scale config
    const configRecord = await this.globalCounters.where('key', '==', 'scaleConfig').first();
    const configName = (configRecord?.value as ScaleConfigName) || '1M+';
    this.scaleConfigName = configName;
    this.scaleConfig = DEFAULT_SCALE_CONFIGS[configName];
  }

  // =============================================
  // I. REQUEST HANDLER
  // =============================================
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Xử lý internal messages
      if (url.hostname === 'broadcast.internal') {
        return await this.handleInternalMessage(request);
      }

      switch (path) {
        case '/broadcast':
          if (request.method === 'POST') {
            return await this.handleCreateBroadcast(request);
          }
          break;
          
        case '/analytics':
          if (request.method === 'GET') {
            const broadcastId = url.searchParams.get('broadcastId');
            if (broadcastId) {
              return await this.getBroadcastAnalytics(broadcastId);
            }
          }
          break;
          
        case '/scale':
          if (request.method === 'POST') {
            return await this.handleUpdateScaleConfig(request);
          }
          break;
          
        case '/health':
          return await this.getHealthStatus();
          
        case '/stats':
          return await this.getServiceStats();
          
        default:
          return this.createErrorResponse('NOT_FOUND', 'Endpoint not found');
      }

      return this.createErrorResponse('METHOD_NOT_ALLOWED', 'Method not allowed');
    } catch (error) {
      handleError(error, 'BroadcastServiceDO fetch failed');
      return this.createErrorResponse('INTERNAL_ERROR', 'Internal server error');
    }
  }

  // =============================================
  // II. INTERNAL MESSAGE HANDLER
  // =============================================
  private async handleInternalMessage(request: Request): Promise<Response> {
    try {
      // Ép kiểu rõ ràng cho dữ liệu JSON
      const body = await request.json() as {
        action: string;
        [key: string]: any;
      };

      const { action, ...data } = body;
      
      switch (action) {
        case 'delivery_report':
          await this.handleDeliveryReport(data);
          break;
        case 'shard_health':
          await this.handleShardHealthReport(data);
          break;
        default:
          return this.createErrorResponse('INVALID_ACTION', 'Unknown action');
      }
      
      return new Response(JSON.stringify({ status: 'processed' }));
    } catch (error) {
      return this.createErrorResponse('INTERNAL_ERROR', 'Internal message processing failed');
    }
  }

  private async handleDeliveryReport(data: any) {
    const { broadcastId, deliveredCount, shardName, timestamp } = data;
    
    if (broadcastId && deliveredCount) {
      await this.updateDeliveryCount(broadcastId, deliveredCount);
      console.log(`📊 Shard ${shardName} reported ${deliveredCount} deliveries for ${broadcastId}`);
    }
  }

  private async handleShardHealthReport(data: any) {
    // Xử lý báo cáo health từ shard nếu cần
    console.log(`🏥 Shard health report:`, data);
  }

  // =============================================
  // II. BROADCAST MANAGEMENT
  // =============================================
  private async handleCreateBroadcast(request: Request): Promise<Response> {
    try {
      const body = await request.json();
      const createData: CreateBroadcast = BroadcastValidator.validateCreateBroadcast(body);
      
      const broadcastId = await this.createBroadcast(createData);
      const estimatedUsers = await this.getTotalUsers();
      
      const response: BroadcastResponse = {
        broadcastId,
        status: 'started',
        config: this.scaleConfig,
        estimatedUsers,
        queuePosition: 0
      };

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleError(error, 'Create broadcast failed');
      return this.createErrorResponse('VALIDATION_ERROR', 'Invalid broadcast data');
    }
  }

  async createBroadcast(createData: CreateBroadcast): Promise<string> {
    const broadcastId = `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const broadcastData: BroadcastData = {
      message: BroadcastValidator.sanitizeBroadcastMessage(createData.message),
      timestamp: Date.now(),
      status: 'pending',
      delivered: 0,
      total: createData.targetUsers ? createData.targetUsers.length : 0,
      targetUsers: createData.targetUsers || null,
      priority: createData.priority || 'normal',
      expiresAt: createData.expiresIn ? Date.now() + createData.expiresIn : undefined,
      broadcastId,
      retryCount: 0
    };

    await this.broadcasts.create(broadcastData);

    // Trigger async processing với FULL MESSAGE DATA
    this.state.waitUntil(this.processBroadcastWithMessage(broadcastId, broadcastData.message, createData.targetUsers));
    
    return broadcastId;
  }

  async getBroadcastData<T = any>(broadcastId: string): Promise<T | undefined> {
    if (!BroadcastValidator.validateBroadcastId(broadcastId)) {
      return undefined;
    }
    return await this.broadcasts.findById(broadcastId) as T;
  }

  // PHƯƠNG THỨC MỚI: Xử lý broadcast với full message data
  private async processBroadcastWithMessage(broadcastId: string, message: any, targetUsers?: string[]) {
    try {
      let broadcastData = await this.getBroadcastData<BroadcastData>(broadcastId);
      if (!broadcastData) {
        throw new Error(`Broadcast ${broadcastId} not found`);
      }

      // Update status
      broadcastData.status = 'processing';
      broadcastData.startedAt = Date.now();
      await this.broadcasts.update(broadcastId, broadcastData);

      let userShards: string[] = [];
      let totalUsers = 0;

      if (targetUsers) {
        // Targeted broadcast - calculate shards from target users
        const shardMap = new Map<string, string[]>(); // shardName -> userIds[]
        for (const userId of targetUsers) {
          if (BroadcastValidator.validateUserId(userId)) {
            const shardName = this.getShardForUser(userId);
            if (!shardMap.has(shardName)) {
              shardMap.set(shardName, []);
            }
            shardMap.get(shardName)!.push(userId);
          }
        }
        userShards = Array.from(shardMap.keys());
        totalUsers = targetUsers.length;
        
        // Lưu shard distribution với user lists
        await this.storage.put(`shard_dist_${broadcastId}`, Object.fromEntries(shardMap));
      } else {
        // Global broadcast - get all shards
        userShards = await this.getAllShards();
        totalUsers = await this.getTotalUsers();
      }

      broadcastData.total = totalUsers;
      await this.broadcasts.update(broadcastId, broadcastData);

      // ĐẨY FULL MESSAGE DATA XUỐNG SHARDS
      const broadcastPayload = {
        broadcastId,
        message: message, // QUAN TRỌNG: đẩy luôn message content
        timestamp: Date.now(),
        targetUsers: targetUsers || null,
        expiresAt: broadcastData.expiresAt,
        priority: broadcastData.priority
      };

      // Gửi song song đến tất cả shards - FIRE AND FORGET
      await this.broadcastToShards(userShards, broadcastPayload);

      // Không cập nhật status completed ở đây, để shards báo cáo sau
      console.log(`🚀 Broadcast ${broadcastId} sent to ${userShards.length} shards with full message data`);

    } catch (error) {
      await this.markBroadcastFailed(broadcastId, error);
      throw error;
    }
  }

  // PHƯƠNG THỨC MỚI: Gửi broadcast đến shards mà không chờ kết quả
  private async broadcastToShards(shards: string[], payload: any) {
    const shardPromises = shards.map(shardName => 
      this.sendToShard(shardName, 'broadcast', payload)
    );

    // Không chờ kết quả - fire and forget
    this.state.waitUntil(Promise.allSettled(shardPromises));
  }

  // PHƯƠNG THỨC MỚI: Gửi message không đồng bộ đến shard
  private async sendToShard(shardName: string, action: string, data: any) {
    try {
      const shardDO = this.env.USER_SHARD_DO.get(
        this.env.USER_SHARD_DO.idFromName(shardName)
      );
      
      // Sử dụng internal endpoint để giảm overhead
      await shardDO.fetch('https://shard.internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      });
      
    } catch (error) {
      console.warn(`Failed to send to shard ${shardName}:`, error);
      // Không throw error để không ảnh hưởng đến các shard khác
    }
  }

  // PHƯƠNG THỨC MỚI: Cập nhật delivery count hiệu quả hơn
  private async updateDeliveryCount(broadcastId: string, deliveredCount: number) {
    const broadcastData = await this.broadcasts.findById(broadcastId);
    if (broadcastData) {
      await this.broadcasts.update(broadcastId, {
        ...broadcastData,
        delivered: (broadcastData.delivered || 0) + deliveredCount,
        lastDeliveryTime: Date.now()
      });

      // Tự động đánh dấu completed nếu đã gửi hết
      if (broadcastData.total > 0 && (broadcastData.delivered + deliveredCount) >= broadcastData.total) {
        await this.broadcasts.update(broadcastId, {
          ...broadcastData,
          status: 'completed',
          completedAt: Date.now()
        });
      }
    }
  }

  // =============================================
  // III. USER MANAGEMENT
  // =============================================
  async registerUser(userId: string) {
    if (!BroadcastValidator.validateUserId(userId)) {
      throw new Error('Invalid user ID');
    }

    const shardName = this.getShardForUser(userId);
    // Register user in shard
    const shardDO = this.env.USER_SHARD_DO.get(
      this.env.USER_SHARD_DO.idFromName(shardName)
    );
    await shardDO.registerUser(userId);
    
    // Register user in shard using table
    const existingShard = await this.userShards.where('shardName', '==', shardName).first();
    const now = Date.now();
    
    if (existingShard) {
      await this.userShards.update(existingShard.id, {
        userCount: existingShard.userCount + 1,
        updatedAt: now
      });
    } else {
      await this.userShards.create({
        shardName,
        userCount: 1,
        createdAt: now,
        updatedAt: now
      });
    }

    // Update global counters
    const totalUsersCounter = await this.globalCounters.where('key', '==', 'totalUsers').first();
    if (totalUsersCounter) {
      await this.globalCounters.update(totalUsersCounter.id, {
        value: totalUsersCounter.value + 1,
        updatedAt: now
      });
    }
  }

  async unregisterUser(userId: string) {
    if (!BroadcastValidator.validateUserId(userId)) {
      return;
    }

    const shardName = this.getShardForUser(userId);

    // Unregister user in shard
    const shardDO = this.env.USER_SHARD_DO.get(
      this.env.USER_SHARD_DO.idFromName(shardName)
    );
    await shardDO.unregisterUser(userId);

    const existingShard = await this.userShards.where('shardName', '==', shardName).first();
    const now = Date.now();
    
    if (existingShard) {
      await this.userShards.update(existingShard.id, {
        userCount: Math.max(0, existingShard.userCount - 1),
        updatedAt: now
      });
    }

    // Update global counters
    const totalUsersCounter = await this.globalCounters.where('key', '==', 'totalUsers').first();
    if (totalUsersCounter && totalUsersCounter.value > 0) {
      await this.globalCounters.update(totalUsersCounter.id, {
        value: totalUsersCounter.value - 1,
        updatedAt: now
      });
    }
  }

  // =============================================
  // IV. DELIVERY TRACKING
  // =============================================
  async recordDelivery(broadcastId: string, userId: string) {
    if (!BroadcastValidator.validateBroadcastId(broadcastId) || 
        !BroadcastValidator.validateUserId(userId)) {
      return;
    }

    try {
      // Update broadcast delivery count
      const broadcastData = await this.broadcasts.findById(broadcastId);
      if (!broadcastData) return;

      const updatedBroadcast = {
        ...broadcastData,
        delivered: (broadcastData.delivered || 0) + 1,
        lastDeliveryTime: Date.now()
      };
      await this.broadcasts.update(broadcastId, updatedBroadcast);

      // Create delivery record
      const deliveryRecord: DeliveryRecord = {
        broadcastId,
        userId,
        deliveredAt: Date.now(),
        shardName: this.getShardForUser(userId),
        success: true,
        attempt: 1
      };

      await this.deliveryRecords.create(deliveryRecord);

      // Log progress periodically
      if (updatedBroadcast.delivered % 1000 === 0) {
        console.log(`📊 Broadcast ${broadcastId}: ${updatedBroadcast.delivered}/${updatedBroadcast.total} delivered`);
      }

    } catch (error) {      
      await this.recordDeliveryFallback(broadcastId);
      throw error;
    }
  }

  private async recordDeliveryFallback(broadcastId: string) {
    const broadcastData = await this.broadcasts.findById(broadcastId);
    if (broadcastData) {
      await this.broadcasts.update(broadcastId, {
        ...broadcastData,
        delivered: (broadcastData.delivered || 0) + 1
      });
    }
  }

  // =============================================
  // V. ANALYTICS & MONITORING
  // =============================================
  async getBroadcastAnalytics(broadcastId: string): Promise<Response> {
    try {
      if (!BroadcastValidator.validateBroadcastId(broadcastId)) {
        return this.createErrorResponse('VALIDATION_ERROR', 'Invalid broadcast ID');
      }

      const stats = await this.getDeliveryStats(broadcastId);
      if (!stats) {
        return this.createErrorResponse('NOT_FOUND', 'Broadcast not found');
      }

      const estimatedCompletionSeconds = stats.deliveryRate > 0 ? stats.pending / stats.deliveryRate : Infinity;
      const estimatedCompletionTime = 
        isFinite(estimatedCompletionSeconds)
          ? new Date(Date.now() + estimatedCompletionSeconds * 1000).toISOString()
          : null;       

      const analytics: BroadcastAnalytics = {
        ...stats,
        estimatedCompletionSeconds: estimatedCompletionSeconds,
        estimatedCompletionTime: estimatedCompletionTime,
        status: stats.completionPercentage === 100 ? 'completed' : 
                stats.deliveryRate > 0 ? 'in_progress' : 'stalled',
        shardProgress: await this.getShardProgress(broadcastId),
        failed: 0,
        elapsedSeconds: (Date.now() - stats.startTime) / 1000        
      };

      return new Response(JSON.stringify(analytics), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleError(error, 'Get broadcast analytics failed');
      return this.createErrorResponse('INTERNAL_ERROR', 'Failed to get analytics');
    }
  }

  private async getDeliveryStats(broadcastId: string): Promise<DeliveryStats | null> {
    const data = await this.broadcasts.findById(broadcastId);
    if (!data) return null;
    
    // Calculate delivery rate (deliveries per second)
    const startTime = data.startedAt || data.timestamp;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? data.delivered / elapsed : 0;
    
    // Get sample deliveries using table query
    const deliveries = await this.deliveryRecords
      .where('broadcastId', '==', broadcastId)
      .limit(10)
      .get();

    const sampleDeliveries = deliveries.map(record => ({
      userId: record.userId,
      deliveredAt: new Date(record.deliveredAt).toISOString()
    }));

    return {
      broadcastId,
      totalUsers: data.total,
      delivered: data.delivered,
      pending: Math.max(0, data.total - data.delivered),
      deliveryRate: Math.round(rate * 100) / 100,
      completionPercentage: data.total > 0 ? 
        Math.round((data.delivered / data.total) * 100) : 0,
      startTime,
      currentTime: Date.now(),
      sampleDeliveries
    };
  }

  private async getShardProgress(broadcastId: string) {
    const deliveries = await this.deliveryRecords
      .where('broadcastId', '==', broadcastId)
      .limit(1000)
      .get();

    const shardCounts = new Map<string, { delivered: number, total: number }>();
    
    for (const record of deliveries) {
      const shardName = record.shardName;
      const current = shardCounts.get(shardName) || { delivered: 0, total: 0 };
      current.delivered++;
      shardCounts.set(shardName, current);
    }

    // Get total users per shard
    const allShards = await this.userShards.getAll();
    for (const shard of allShards) {
      const counts = shardCounts.get(shard.shardName) || { delivered: 0, total: 0 };
      counts.total = shard.userCount;
      shardCounts.set(shard.shardName, counts);
    }

    const result: Record<string, { delivered: number, total: number, percentage: number }> = {};
    
    for (const [shardName, counts] of shardCounts.entries()) {
      result[shardName] = {
        delivered: counts.delivered,
        total: counts.total,
        percentage: counts.total > 0 ? Math.round((counts.delivered / counts.total) * 100) : 0
      };
    }

    return result;
  }

  // =============================================
  // VI. SCALING & CONFIGURATION
  // =============================================
  private async handleUpdateScaleConfig(request: Request): Promise<Response> {
    try {
      const body = await request.json();
      const { scale } = body as { scale: string };
      
      if (!scale || !DEFAULT_SCALE_CONFIGS[scale as ScaleConfigName]) {
        return this.createErrorResponse('VALIDATION_ERROR', 'Invalid scale configuration');
      }

      const previousScale = this.scaleConfigName;
      await this.updateScaleConfig(scale as ScaleConfigName);
      
      const response: ScaleConfigResponse = {
        scale: scale as ScaleConfigName,
        config: this.scaleConfig,
        previousScale,
        estimatedCapacity: this.getEstimatedCapacity()
      };

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      handleError(error, 'Update scale config failed');
      return this.createErrorResponse('INTERNAL_ERROR', 'Failed to update scale config');
    }
  }

  async updateScaleConfig(scale: ScaleConfigName) {
    this.scaleConfigName = scale;
    this.scaleConfig = DEFAULT_SCALE_CONFIGS[scale];
    
    // Update in global counters
    const configRecord = await this.globalCounters.where('key', '==', 'scaleConfigName').first();
    const now = Date.now();
    
    if (configRecord) {
      await this.globalCounters.update(configRecord.id, {
        value: scale,
        updatedAt: now
      });
    } else {
      await this.globalCounters.create({
        key: 'scaleConfigName',
        value: scale,
        updatedAt: now
      });
    }
  }

  private getEstimatedCapacity(): string {
    const usersPerShard = 1000;
    const totalCapacity = this.scaleConfig.SHARD_COUNT * usersPerShard;
    
    if (totalCapacity >= 1000000) return `${Math.round(totalCapacity / 1000000)}M+`;
    if (totalCapacity >= 1000) return `${Math.round(totalCapacity / 1000)}K+`;
    return `${totalCapacity}+`;
  }

  // =============================================
  // VII. HEALTH & STATUS
  // =============================================
  async getHealthStatus(): Promise<Response> {
    const [totalUsers, activeShards, serviceConfig] = await Promise.all([
      this.getTotalUsers(),
      this.getAllShards(),
      this.serviceConfigs.findById('default') || DEFAULT_SERVICE_CONFIG
    ]);

    const health = {
      status: 'healthy' as const,
      timestamp: Date.now(),
      metrics: {
        totalUsers,
        activeShards: activeShards.length,
        scaleConfig: this.scaleConfigName,
        deliveryRate: 0
      },
      config: serviceConfig
    };

    return new Response(JSON.stringify(health), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getServiceStats(): Promise<Response> {
    const [totalUsers, activeShards, recentBroadcasts] = await Promise.all([
      this.getTotalUsers(),
      this.getAllShards(),
      this.getRecentBroadcasts(10)
    ]);

    const stats = {
      totalUsers,
      activeShards: activeShards.length,
      scaleConfig: this.scaleConfigName,
      recentBroadcasts,
      timestamp: Date.now()
    };

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async getRecentBroadcasts(limit: number) {
    const broadcasts = await this.broadcasts.getAll();
    
    // Sort by timestamp and limit
    return broadcasts
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(broadcast => ({
        broadcastId: broadcast.broadcastId,
        status: broadcast.status,
        delivered: broadcast.delivered,
        total: broadcast.total,
        timestamp: broadcast.timestamp
      }));
  }

  // =============================================
  // VIII. UTILITY METHODS
  // =============================================
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

  private async getAllShards(): Promise<string[]> {
    const shards = await this.userShards.getAll();
    return shards.map(shard => shard.shardName);
  }

  private async getTotalUsers(): Promise<number> {
    const counter = await this.globalCounters.where('key', '==', 'totalUsers').first();
    return counter?.value || 0;
  }

  private async markBroadcastFailed(broadcastId: string, error: any) {
    const data = await this.broadcasts.findById(broadcastId);
    if (data) {
      await this.broadcasts.update(broadcastId, {
        ...data,
        status: 'failed',
        error: error.message
      });
    }
  }

  private createErrorResponse(code: string, message: string): Response {
    const errorResponse: ErrorResponse = {
      error: message,
      code,
      timestamp: Date.now()
    };

    return new Response(JSON.stringify(errorResponse), {
      status: code === 'NOT_FOUND' ? 404 : 
              code === 'VALIDATION_ERROR' ? 400 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}