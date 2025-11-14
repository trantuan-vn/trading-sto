import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { 
  ShardConfig, 
  ShardConfigName, 
  ShardInfo, 
  UserRegistration, 
  UserBatch, 
  ShardPerformance,
  CleanupOperation,
  ShardConfigResponse,
  UserCountResponse,
  DEFAULT_SHARD_CONFIGS, 
  ShardValidator,
  UserRegistrationSchema,
  CleanupOperationSchema,
  ShardPerformanceSchema,
  ShardConfigSchema
} from '../domain';

import { handleErrorWithoutIp } from '../../../shared/utils';

export class UserShardDO extends DurableObject {
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;
  
  // Table instances
  private userRegistrations;
  private cleanupOperations;
  private shardPerformances;
  private shardConfigs;
  
  private shardConfig: ShardConfig = DEFAULT_SHARD_CONFIGS['1M+'];
  private shardConfigName: ShardConfigName = '1M+';

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.storage = state.storage;
    this.database = new UserDODatabase(
      this.storage,
      this.getCurrentUserId()
    );    

    // Initialize tables
    this.userRegistrations = this.table('user_registrations', UserRegistrationSchema);
    this.cleanupOperations = this.table('cleanup_operations', CleanupOperationSchema);
    this.shardPerformances = this.table('shard_performances', ShardPerformanceSchema);
    this.shardConfigs = this.table('shard_configs', ShardConfigSchema);

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
    // Initialize shard config
    const existingConfig = await this.shardConfigs.where('key', '==', 'shardConfig').first();
    if (!existingConfig) {
      await this.shardConfigs.create(DEFAULT_SHARD_CONFIGS['1M+']);
      // Initialize performance metrics
      await this.shardPerformances.create(this.getInitialPerformanceMetrics());
    }
    
    // Load shard config
    const configRecord = await this.shardConfigs.where('key', '==', 'shardConfig').first();
    this.shardConfig = configRecord ?? DEFAULT_SHARD_CONFIGS['1M+'];
  }

  // =============================================
  // I. REQUEST HANDLER
  // =============================================
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Xử lý internal messages
    if (url.hostname === 'shard.internal') {
      return await this.handleInternalMessage(request);
    }

    switch (path) {
      case '/info':
        return await this.getShardInfo();
        
      case '/users':
        if (request.method === 'GET') {
          return await this.getUsersList();
        }
        break;
        
      case '/count':
        return await this.getUserCountResponse();
        
      case '/config':
        if (request.method === 'POST') {
          return await this.handleUpdateConfig(request);
        }
        break;
        
      case '/cleanup':
        if (request.method === 'POST') {
          return await this.handleCleanup(request);
        }
        break;
        
      case '/performance':
        return await this.getPerformanceMetrics();
        
      default:
        throw new Error(`Unknown path: ${path}`);
    }
    throw new Error('Method not allowed');
  }

  // =============================================
  // II. INTERNAL MESSAGE HANDLER
  // =============================================
  private async handleInternalMessage(request: Request): Promise<Response> {
    // Ép kiểu rõ ràng cho dữ liệu JSON
    const body = await request.json() as {
      action: string;
      [key: string]: any;
    };

    const { action, ...data } = body;
    
    switch (action) {
      case 'broadcast':
        await this.handleFastBroadcast(data);
        break;
      case 'user_delivery_report':
        await this.handleUserDeliveryReport(data);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    
    return new Response(JSON.stringify({ status: 'processed' }));
  }

  // PHƯƠNG THỨC MỚI: Broadcast nhanh không chờ response
  private async handleFastBroadcast(data: any) {
    const { broadcastId, message, targetUsers } = data;
    
    console.log(`🚀 Shard ${this.getShardName()} fast broadcast: ${broadcastId}`);
    
    // Trigger broadcast mà không chờ kết quả
    this.state.waitUntil(this.processFastBroadcast(broadcastId, message, targetUsers));
    
    return { status: 'accepted' };
  }

  // PHƯƠNG THỨC MỚI: Xử lý broadcast tối ưu với full message
  private async processFastBroadcast(broadcastId: string, message: any, targetUsers?: string[]) {
    const users = targetUsers 
      ? await this.getSpecificUsers(targetUsers) // Chỉ lấy users cụ thể
      : await this.getActiveUsers(); // Lấy tất cả active users

    if (users.length === 0) {
      console.log(`📭 Shard ${this.getShardName()} no users to broadcast`);
      return;
    }

    console.log(`🎯 Shard ${this.getShardName()} broadcasting to ${users.length} users`);

    // Chia thành batches và gửi ngay lập tức với FULL MESSAGE
    const batches = this.createOptimizedBatches(users, broadcastId);
    await this.sendBatchesWithMessage(batches, broadcastId, message);

    // Báo cáo estimated delivery count (không cần chờ)
    this.state.waitUntil(this.reportEstimatedDelivery(broadcastId, users.length));
  }

  // PHƯƠNG THỨC MỚI: Lấy specific users hiệu quả
  private async getSpecificUsers(userIds: string[]): Promise<string[]> {
    const validUsers: string[] = [];
    
    // Sử dụng transaction để lấy nhiều users cùng lúc
    for (const userId of userIds) {
      const user = await this.userRegistrations.where('userId', '==', userId).first();
      if (user && user.isActive) {
        validUsers.push(userId);
      }
    }
    
    return validUsers;
  }

  // PHƯƠNG THỨC MỚI: Lấy active users
  private async getActiveUsers(): Promise<string[]> {
    const users = await this.userRegistrations.getAll();
    return users
      .filter(user => user.isActive)
      .map(user => user.userId);
  }

  // PHƯƠNG THỨC MỚI: Tạo batches tối ưu
  private createOptimizedBatches(userIds: string[], broadcastId: string): UserBatch[] {
    const batchSize = this.shardConfig.BATCH_SIZE
    const chunks = this.chunkArray(userIds, batchSize);
    
    return chunks.map((userIdsChunk, index) => ({
      batchId: `${broadcastId}_batch_${index}`,
      userIds: userIdsChunk,
      shardName: this.getShardName(),
      createdAt: Date.now(),
      broadcastId,
      size: userIdsChunk.length,           
      processingOrder: index,              
      priority: 'normal',                  
    }));
  }

  // PHƯƠNG THỨC MỚI: Gửi batches bất đồng bộ với message
  private async sendBatchesWithMessage(batches: UserBatch[], broadcastId: string, message: any) {
    // Gửi tất cả batches cùng lúc, không chờ
    const sendPromises = batches.map(batch => 
      this.sendBatchToUsersWithMessage(batch, broadcastId, message)
    );

    // Không chờ kết quả, để tối đa throughput
    this.state.waitUntil(Promise.allSettled(sendPromises));
  }

  // PHƯƠNG THỨC MỚI: Gửi batch đến users với full message
  private async sendBatchToUsersWithMessage(batch: UserBatch, broadcastId: string, message: any) {
    // Gửi song song đến tất cả users trong batch
    const userPromises = batch.userIds.map(userId =>
      this.sendToUserDirect(userId, {
        type: 'broadcast',
        broadcastId,
        message: message,
        timestamp: Date.now()
      })
    );

    const results = await Promise.allSettled(userPromises);
    const successfulSends = results.filter(r => r.status === 'fulfilled').length;
    
    // Cập nhật metrics local
    await this.updateLocalMetrics(broadcastId, successfulSends);

    console.log(`✅ Batch ${batch.batchId}: ${successfulSends}/${batch.userIds.length} users sent`);
  }

  // PHƯƠNG THỨC MỚI: Gửi message đến user nhanh
  private async sendToUserDirect(userId: string, message: any) {
    const userDO = this.env.USER_DO.get(
      this.env.USER_DO.idFromName(userId)
    );
    
    // Sử dụng internal endpoint để tránh overhead của WebSocket
    await userDO.fetch('https://user.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    
    return { success: true, userId };
  }

  // PHƯƠNG THỨC MỚI: Cập nhật metrics local
  private async updateLocalMetrics(broadcastId: string, deliveredCount: number) {
    // Lưu delivery count local để báo cáo batch sau
    const current = await this.storage.get<number>(`delivery_${broadcastId}`) || 0;
    await this.storage.put(`delivery_${broadcastId}`, current + deliveredCount);
  }

  // PHƯƠNG THỨC MỚI: Báo cáo delivery count định kỳ
  private async reportEstimatedDelivery(broadcastId: string, estimatedTotal: number) {
    // Đợi một khoảng thời gian ngắn để thu thập delivery counts
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const deliveredCount = await this.storage.get<number>(`delivery_${broadcastId}`) || 0;
    
    if (deliveredCount > 0) {
      const broadcastService = this.env.BROADCAST_SERVICE_DO.get(
        this.env.BROADCAST_SERVICE_DO.idFromName("global")
      );
      
      // Gửi báo cáo delivery đến service
      await broadcastService.fetch('https://broadcast.internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delivery_report',
          broadcastId,
          deliveredCount,
          shardName: this.getShardName(),
          timestamp: Date.now()
        })
      });
      
      console.log(`📊 Shard ${this.getShardName()} reported ${deliveredCount} deliveries for ${broadcastId}`);
      
      // Reset counter local
      await this.storage.delete(`delivery_${broadcastId}`);        
    }
  }

  // PHƯƠNG THỨC MỚI: Xử lý báo cáo delivery từ users
  private async handleUserDeliveryReport(data: any) {
    const { broadcastId, deliveredCount } = data;
    
    if (broadcastId && deliveredCount) {
      await this.updateLocalMetrics(broadcastId, deliveredCount);
    }
  }

  // =============================================
  // III. USER MANAGEMENT
  // =============================================
  async registerUser(userId: string) {
    if (!ShardValidator.isValidUserId(userId)) {
      throw new Error('Invalid user ID');
    }

    // Check if user already exists
    const existingUser = await this.userRegistrations.where('userId', '==', userId).first();
    if (existingUser) {
      // Update last active time
      await this.userRegistrations.update(existingUser.id, {
        ...existingUser,
        isActive: true
      });
      return;
    }

    // Create new user registration
    const userRegistration: UserRegistration = ShardValidator.validateUserRegistration(userId, this.getShardName());
    await this.userRegistrations.create({
      userId: userRegistration.userId,
      shardName: userRegistration.shardName,
      tags: [],
      priority: 'normal',
      isActive: true
    });

    // Update performance metrics
    await this.updatePerformanceMetrics({
      totalUsers: await this.getUserCount(),
      userGrowthRate: 1
    });
  }

  async unregisterUser(userId: string) {
    if (!ShardValidator.isValidUserId(userId)) {
      return;
    }

    const existingUser = await this.userRegistrations.where('userId', '==', userId).first();
    if (existingUser) {
      await this.userRegistrations.delete(existingUser.id);
      
      // Update performance metrics
      await this.updatePerformanceMetrics({
        totalUsers: await this.getUserCount(),
        userGrowthRate: -1
      });
    }
  }

  // =============================================
  // IV. SHARD MANAGEMENT & INFO
  // =============================================
  async getShardInfo(): Promise<Response> {
    const [userCount, performance, shardName] = await Promise.all([
      this.getUserCount(),
      this.getPerformanceMetricsData(),
      this.getShardName()
    ]);

    const shardInfo: ShardInfo = {
      shardName,
      userCount,
      config: this.shardConfig,
      timestamp: Date.now(),
      processingLoad: performance.activeUsers / (performance.totalUsers || 1),
      averageBatchTime: performance.averageProcessingTime,
      lastActivity: performance.timestamp,
      healthStatus: this.calculateHealthStatus(performance),
      errorRate: performance.errorRate || 0
    };

    return new Response(JSON.stringify(shardInfo), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getUsersList(): Promise<Response> {
    const users = await this.userRegistrations.getAll();
    const userList = users.map(user => user.userId);

    return new Response(JSON.stringify({ 
      users: userList,
      count: userList.length,
      shardName: this.getShardName()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getUserCountResponse(): Promise<Response> {
    const userCount = await this.getUserCount();
    const performance = await this.getPerformanceMetricsData();

    const response: UserCountResponse = {
      shardName: this.getShardName(),
      userCount,
      activeUsers: performance.activeUsers,
      timestamp: Date.now()
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async getUserCount(): Promise<number> {
    const users = await this.userRegistrations.getAll();
    return users.length;
  }

  // =============================================
  // V. CONFIGURATION MANAGEMENT
  // =============================================
  private async handleUpdateConfig(request: Request): Promise<Response> {
    const body = await request.json();
    const { scale } = body as { scale: string };
    
    if (!scale || !DEFAULT_SHARD_CONFIGS[scale as ShardConfigName]) {
      throw new Error('Invalid scale');
    }

    const previousConfig = this.shardConfigName;
    await this.updateShardConfig(scale as ShardConfigName);
    
    const response: ShardConfigResponse = {
      scale: scale as ShardConfigName,
      config: this.shardConfig,
      shardName: this.getShardName(),
      previousConfig,
      estimatedCapacity: this.getEstimatedCapacity()
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async updateShardConfig(scale: ShardConfigName) {
    this.shardConfigName = scale;
    this.shardConfig = DEFAULT_SHARD_CONFIGS[scale];
    
    // Update config in table
    const existingConfig = await this.shardConfigs.where('key', '==', 'shardConfig').first();
    
    if (existingConfig) {
      await this.shardConfigs.update(existingConfig.id, DEFAULT_SHARD_CONFIGS[scale]);
    } else {
      await this.shardConfigs.create(DEFAULT_SHARD_CONFIGS[scale]);
    }
  }

  // =============================================
  // VI. PERFORMANCE MONITORING
  // =============================================
  private getInitialPerformanceMetrics(): ShardPerformance {
    return {
      shardName: this.getShardName(),
      timestamp: Date.now(),
      totalUsers: 0,
      activeUsers: 0,
      userGrowthRate: 0,
      batchesProcessed: 0,
      averageBatchSize: 0,
      averageProcessingTime: 0,
      usersPerSecond: 0,
      peakThroughput: 0,
      errorRate: 0,
      retryRate: 0
    };
  }

  async getPerformanceMetrics(): Promise<Response> {
    const metrics = await this.getPerformanceMetricsData();
    return new Response(JSON.stringify(metrics), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async getPerformanceMetricsData(): Promise<ShardPerformance> {
    const metrics = await this.shardPerformances
      .where('shardName', '==', this.getShardName())
      .first();
    return metrics || this.getInitialPerformanceMetrics();
  }

  private async updatePerformanceMetrics(updates: Partial<ShardPerformance>) {
    const current = await this.getPerformanceMetricsData();
    const updated: ShardPerformance = {
      ...current,
      ...updates,
      timestamp: Date.now()
    };
    
    const existing = await this.shardPerformances
      .where('shardName', '==', this.getShardName())
      .first();
      
    if (existing) {
      await this.shardPerformances.update(existing.id, updated);
    } else {
      await this.shardPerformances.create(updated);
    }
  }

  // =============================================
  // VII. CLEANUP AND MAINTENANCE
  // =============================================
  private async handleCleanup(request: Request): Promise<Response> {
    const body = await request.json();
    const { inactiveUserIds, cleanupThreshold } = body as { inactiveUserIds: string[], cleanupThreshold?: number };

    if (!Array.isArray(inactiveUserIds)) {
      throw new Error('Invalid inactive user IDs');
    }

    const validUserIds = inactiveUserIds.filter(id => ShardValidator.isValidUserId(id));
    const operation = await this.cleanupInactiveUsers(validUserIds, cleanupThreshold);

    return new Response(JSON.stringify(operation), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async cleanupInactiveUsers(inactiveUserIds: string[], cleanupThreshold?: number): Promise<CleanupOperation> {
    if (inactiveUserIds.length === 0) {
      return ShardValidator.validateCleanupOperation([], this.getShardName());
    }

    const operation = ShardValidator.validateCleanupOperation(inactiveUserIds, this.getShardName());
    if (cleanupThreshold) {
      operation.cleanupThreshold = cleanupThreshold;
    }

    try {
      let removedCount = 0;

      for (const userId of inactiveUserIds) {
        const userRecord = await this.userRegistrations.where('userId', '==', userId).first();
        if (userRecord) {
          await this.userRegistrations.delete(userRecord.id);
          removedCount++;
        }
      }

      operation.usersRemoved = removedCount;
      operation.usersSkipped = inactiveUserIds.length - removedCount;
      operation.status = 'completed';
      operation.processingTime = Date.now() - operation.timestamp;

      console.log(`🧹 Shard ${this.getShardName()} cleaned up ${operation.usersRemoved} inactive users`);
      
    } catch (error) {
      handleErrorWithoutIp(error, 'Cleanup operation failed');
      operation.status = 'failed';
      operation.error = String(error);
    }

    await this.cleanupOperations.create(operation);
    return operation;
  }

  // =============================================
  // VIII. UTILITY METHODS
  // =============================================
  private getShardName(): string {
    return this.state.id.toString();
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private calculateHealthStatus(performance: ShardPerformance): 'healthy' | 'degraded' | 'unhealthy' {
    if (performance.errorRate > 0.1) return 'unhealthy';
    if (performance.errorRate > 0.05) return 'degraded';
    return 'healthy';
  }

  private getEstimatedCapacity(): string {
    const usersPerBatch = this.shardConfig.BATCH_SIZE;
    const batchesPerMinute = 60000 / this.shardConfig.DELAY_BETWEEN_BATCHES;
    const hourlyCapacity = usersPerBatch * batchesPerMinute * 60;
    
    if (hourlyCapacity >= 1000000) return `${Math.round(hourlyCapacity / 1000000)}M+/hour`;
    if (hourlyCapacity >= 1000) return `${Math.round(hourlyCapacity / 1000)}K+/hour`;
    return `${hourlyCapacity}+/hour`;
  }
}