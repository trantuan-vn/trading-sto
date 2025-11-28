import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { handleErrorWithoutIp } from '../../../shared/utils.js';
import { UserDODatabase, TableOptions } from '../../../shared/database/index.js';
import { 
  ScaleConfig, ServiceConfigSchema, ScaleConfigName, BroadcastData, 
  BroadcastDataSchema, CreateBroadcast, DeliveryRecordSchema, BroadcastAnalytics, 
  DeliveryStats, BroadcastResponse, ScaleConfigResponse, DEFAULT_SCALE_CONFIGS, 
  DEFAULT_SERVICE_CONFIG, BroadcastValidator, UserShardSchema, GlobalCounterSchema,
  PricePolicySchema, ServiceSchema, VoucherSchema
} from '../domain';

export class BroadcastServiceDO extends DurableObject {
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;
  private broadcasts: any;
  private deliveryRecords: any;
  private serviceConfigs: any;
  private userShards: any;
  private globalCounters: any;
  private scaleConfig: ScaleConfig = DEFAULT_SCALE_CONFIGS['1M+'];
  private scaleConfigName: ScaleConfigName = '1M+';

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.database = new UserDODatabase(this.storage, this.userId);
    
    this.state.blockConcurrencyWhile(async () => {
      this.broadcasts = this.table('broadcasts', BroadcastDataSchema);
      this.deliveryRecords = this.table('delivery_records', DeliveryRecordSchema);
      this.serviceConfigs = this.table('service_configs', ServiceConfigSchema);
      this.userShards = this.table('user_shards', UserShardSchema);
      this.globalCounters = this.table('global_counters', GlobalCounterSchema);
            
      await this.initialize();
    });
  }

  // =============================================
  // GETTERS & INITIALIZATION
  // =============================================
  get userId(): string { return this.state.id.toString(); }

  table<T extends z.ZodSchema>(name: string, schema: T, options?: TableOptions) {
    return this.database.table(name, schema, options);
  }

  private async initialize() {
    const initialized = await this.globalCounters.where('key', '==', 'initialized').first();
    if (!initialized) {
      await Promise.all([
        this.globalCounters.create({ key: 'totalUsers', value: 0 }),
        this.globalCounters.create({ key: 'initialized', value: 1 }),
        this.globalCounters.create({ key: 'scaleConfig', value: '1M+' }),
        this.serviceConfigs.create(DEFAULT_SERVICE_CONFIG)
      ]);
    }
    
    const configRecord = await this.globalCounters.where('key', '==', 'scaleConfig').first();
    this.scaleConfigName = (configRecord?.value as ScaleConfigName) || '1M+';
    this.scaleConfig = DEFAULT_SCALE_CONFIGS[this.scaleConfigName];
  }

  // =============================================
  // REQUEST HANDLER
  // =============================================
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      
      if (url.hostname === 'broadcast.internal') {
        return await this.handleInternalMessage(request);
      }

      const routes: { [key: string]: Function } = {
        '/broadcast': () => request.method === 'POST' ? this.handleCreateBroadcast(request) : null,
        '/analytics': () => request.method === 'GET' ? this.getBroadcastAnalytics(url.searchParams.get('broadcastId') || '') : null,
        '/scale': () => request.method === 'POST' ? this.handleUpdateScaleConfig(request) : null,
        '/health': () => this.getHealthStatus(),
        '/stats': () => this.getServiceStats()
      };

      const handler = routes[url.pathname];
      if (handler) return await handler() || new Response('Method not allowed', { status: 405 });
      
      throw new Error(`Unknown path: ${url.pathname}`);
    } catch (error) {
      handleErrorWithoutIp(error, `BroadcastServiceDO ${this.userId} Fetch error`);
      return new Response("Internal Server Error", { status: 500 });
    }    
  }

  // =============================================
  // INTERNAL MESSAGE HANDLER
  // =============================================
  private async handleInternalMessage(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/repository/')) {
      return await this.handleRepositoryOperations(request, url.pathname);
    }

    const body = await request.json() as { action: string; [key: string]: any };
    const { action, ...data } = body;
    
    const actions: { [key: string]: Function } = {
      delivery_report: () => this.handleDeliveryReport(data),
      registerUser: () => this.registerUser(data.userId),
      unregisterUser: () => this.unregisterUser(data.userId)
    };

    if (actions[action]) await actions[action]();
    return new Response(JSON.stringify({ status: 'processed' }));
  }

  private async handleRepositoryOperations(request: Request, path: string): Promise<Response> {
    const data = await request.json() as any;
    
    const operations: { [key: string]: Function } = {
      '/repository/transaction': () => this.database.execTransaction(data.operations),
      '/repository/select': async () => {
        const result = await this.database.execSelectSQL(data.sql, data.params || []);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      },
      '/repository/action': () => this.handleRepositoryAction(data)
    };

    if (operations[path]) {
      const result = await operations[path]();
      return result instanceof Response ? result : new Response(JSON.stringify(result));
    }
    
    return new Response('Not found', { status: 404 });
  }

  private async handleRepositoryAction(data: any): Promise<Response> {
    const { table, operation, data: opData } = data;
    const tableInstance = this.database.getTable(table);
    if (!tableInstance) return new Response(`Table ${table} not found`, { status: 404 });

    const operations: { [key: string]: Function } = {
      get: () => tableInstance.findById(opData.id),
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

  private async handleDeliveryReport(data: any) {
    const { broadcastId, deliveredCount } = data;
    if (broadcastId && deliveredCount) {
      await this.updateDeliveryCount(broadcastId, deliveredCount);
    }
  }

  // =============================================
  // BROADCAST MANAGEMENT
  // =============================================
  private async handleCreateBroadcast(request: Request): Promise<Response> {
    const createData: CreateBroadcast = BroadcastValidator.validateCreateBroadcast(await request.json());
    const broadcastId = await this.createBroadcast(createData);
    
    const response: BroadcastResponse = {
      broadcastId,
      status: 'started',
      config: this.scaleConfig,
      estimatedUsers: await this.getTotalUsers(),
      queuePosition: 0
    };

    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  }

  async createBroadcast(createData: CreateBroadcast): Promise<string> {
    const broadcastData: BroadcastData = {
      message: BroadcastValidator.sanitizeBroadcastMessage(createData.message),
      timestamp: Date.now(),
      status: 'pending',
      delivered: 0,
      total: createData.targetUsers?.length || 0,
      targetUsers: createData.targetUsers || null,
      priority: createData.priority || 'normal',
      expiresAt: createData.expiresIn ? Date.now() + createData.expiresIn : undefined,
      retryCount: 0
    };

    const broadcast = await this.broadcasts.create(broadcastData);
    this.ctx.waitUntil(this.processBroadcastWithMessage(broadcast.id, broadcast.message, createData.targetUsers));
    
    return broadcast.id;
  }

  private async processBroadcastWithMessage(broadcastId: string, message: any, targetUsers?: string[]) {
    try {
      let broadcastData = await this.broadcasts.findById(broadcastId);
      if (!broadcastData) throw new Error(`Broadcast ${broadcastId} not found`);

      broadcastData.status = 'processing';
      broadcastData.startedAt = Date.now();
      await this.broadcasts.update(broadcastId, broadcastData);

      let userShards: string[];
      let totalUsers = 0;

      if (targetUsers) {
        const shardMap = new Map<string, string[]>();
        for (const userId of targetUsers) {
          if (BroadcastValidator.validateUserId(userId)) {
            const shardName = this.getShardForUser(userId);
            if (!shardMap.has(shardName)) shardMap.set(shardName, []);
            shardMap.get(shardName)!.push(userId);
          }
        }
        userShards = Array.from(shardMap.keys());
        totalUsers = targetUsers.length;        
      } else {
        userShards = await this.getAllShards();
        totalUsers = await this.getTotalUsers();
      }

      broadcastData.total = totalUsers;
      await this.broadcasts.update(broadcastId, broadcastData);

      const broadcastPayload = { broadcastId, message, timestamp: Date.now(), targetUsers, expiresAt: broadcastData.expiresAt, priority: broadcastData.priority };
      await this.broadcastToShards(userShards, broadcastPayload);

    } catch (error) {
      await this.markBroadcastFailed(broadcastId, error);
    }
  }

  private async broadcastToShards(shards: string[], payload: any) {
    const shardPromises = shards.map(shardName => 
      this.sendToShard(shardName, 'broadcast', payload)
    );
    this.ctx.waitUntil(Promise.allSettled(shardPromises));
  }

  private async sendToShard(shardName: string, action: string, data: any) {
    const shardDO = this.env.USER_SHARD_DO.get(this.env.USER_SHARD_DO.idFromName(shardName));
    const response = await shardDO.fetch('https://shard.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });    
    if (!response.ok) throw new Error(`Failed to send broadcast to shard ${shardName}: ${response.statusText}`);
  }

  // =============================================
  // USER MANAGEMENT
  // =============================================
  async registerUser(userId: string) {
    const shardName = this.getShardForUser(userId);
    const [existingShard, totalUsersCounter] = await Promise.all([
      this.userShards.where('shardName', '==', shardName).first(),
      this.globalCounters.where('key', '==', 'totalUsers').first()
    ]);

    if (!totalUsersCounter) throw new Error('Total users counter not found');

    await this.database.dynamicMultiTableTransaction([
      {
        table: 'user_shards',
        operation: 'upsert',
        data: { shardName, userCount: (existingShard?.userCount || 0) + 1 }
      },
      {
        table: 'global_counters',
        operation: 'update',
        id: totalUsersCounter.id,
        data: { value: totalUsersCounter.value + 1 }
      }
    ]);

    await this.executeShardOperation('registerUser', shardName, existingShard, totalUsersCounter);
  }

  async unregisterUser(userId: string) {
    const shardName = this.getShardForUser(userId);
    const [existingShard, totalUsersCounter] = await Promise.all([
      this.userShards.where('shardName', '==', shardName).first(),
      this.globalCounters.where('key', '==', 'totalUsers').first()
    ]);

    if (!existingShard || !totalUsersCounter) throw new Error('Shard or counter not found');

    await this.database.dynamicMultiTableTransaction([
      {
        table: 'user_shards',
        operation: 'update',
        id: existingShard.id,
        data: { userCount: Math.max(0, existingShard.userCount - 1) }
      },
      {
        table: 'global_counters', 
        operation: 'update',
        id: totalUsersCounter.id,
        data: { value: Math.max(0, totalUsersCounter.value - 1) }
      }
    ]);

    await this.executeShardOperation('unregisterUser', shardName, existingShard, totalUsersCounter);
  }

  private async executeShardOperation(action: 'registerUser' | 'unregisterUser', shardName: string, existingShard: any, totalUsersCounter: any) {
    const shardDO = this.env.USER_SHARD_DO.get(this.env.USER_SHARD_DO.idFromName(shardName));
    const response = await shardDO.fetch('https://shard.internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId: this.userId })
    });
    
    if (!response.ok) {
      await this.database.dynamicMultiTableTransaction([
        {
          table: 'user_shards',
          operation: 'upsert',
          data: { shardName, userCount: existingShard?.userCount || 0 }
        },
        {
          table: 'global_counters',
          operation: 'update', 
          id: totalUsersCounter.id,
          data: { value: totalUsersCounter.value }
        }
      ]);
      throw new Error(`Failed to ${action}: ${response.statusText}`);
    }
  }

  // =============================================
  // DELIVERY TRACKING & ANALYTICS
  // =============================================
  private async updateDeliveryCount(broadcastId: string, deliveredCount: number) {
    const broadcastData = await this.broadcasts.findById(broadcastId);
    if (broadcastData?.status === 'processing') {
      const newDelivered = (broadcastData.delivered || 0) + deliveredCount;
      const updates: any = {
        delivered: newDelivered,
        lastDeliveryTime: Date.now()
      };

      if (broadcastData.total > 0 && newDelivered >= broadcastData.total) {
        updates.status = 'completed';
        updates.completedAt = Date.now();
      }

      await this.broadcasts.update(broadcastId, { ...broadcastData, ...updates });
    }
  }

  async getBroadcastAnalytics(broadcastId: string): Promise<Response> {
    if (!BroadcastValidator.validateBroadcastId(broadcastId)) {
      throw new Error('Invalid broadcast ID');
    }

    const stats = await this.getDeliveryStats(broadcastId);
    if (!stats) throw new Error('Broadcast not found');

    const estimatedCompletionSeconds = stats.deliveryRate > 0 ? stats.pending / stats.deliveryRate : Infinity;
    const analytics: BroadcastAnalytics = {
      ...stats,
      estimatedCompletionSeconds,
      estimatedCompletionTime: isFinite(estimatedCompletionSeconds) ? new Date(Date.now() + estimatedCompletionSeconds * 1000).toISOString() : null,
      status: stats.completionPercentage === 100 ? 'completed' : stats.deliveryRate > 0 ? 'in_progress' : 'stalled',
      shardProgress: await this.getShardProgress(broadcastId),
      failed: 0,
      elapsedSeconds: (Date.now() - stats.startTime) / 1000        
    };

    return new Response(JSON.stringify(analytics), { headers: { 'Content-Type': 'application/json' } });
  }

  private async getDeliveryStats(broadcastId: string): Promise<DeliveryStats | null> {
    const data = await this.broadcasts.findById(broadcastId);
    if (!data) return null;
    
    const startTime = data.startedAt || data.timestamp;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? data.delivered / elapsed : 0;
    
    const deliveries = await this.deliveryRecords
      .where('broadcastId', '==', broadcastId)
      .limit(10)
      .get();

    return {
      broadcastId,
      totalUsers: data.total,
      delivered: data.delivered,
      pending: Math.max(0, data.total - data.delivered),
      deliveryRate: Math.round(rate * 100) / 100,
      completionPercentage: data.total > 0 ? Math.round((data.delivered / data.total) * 100) : 0,
      startTime,
      currentTime: Date.now(),
      sampleDeliveries: deliveries.map((record: any) => ({
        userId: record.userId,
        deliveredAt: new Date(record.deliveredAt).toISOString()
      }))
    };
  }

  private async getShardProgress(broadcastId: string) {
    const [deliveries, allShards] = await Promise.all([
      this.deliveryRecords.where('broadcastId', '==', broadcastId).limit(1000).get(),
      this.userShards.getAll()
    ]);

    const shardCounts = new Map<string, { delivered: number, total: number }>();
    
    for (const record of deliveries) {
      const shardName = record.shardName;
      const current = shardCounts.get(shardName) || { delivered: 0, total: 0 };
      current.delivered++;
      shardCounts.set(shardName, current);
    }

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
  // SCALING & HEALTH
  // =============================================
  private async handleUpdateScaleConfig(request: Request): Promise<Response> {
    const { scale } = await request.json() as { scale: string };
    if (!scale || !DEFAULT_SCALE_CONFIGS[scale as ScaleConfigName]) {
      throw new Error('Invalid scale');
    }

    const previousScale = this.scaleConfigName;
    await this.updateScaleConfig(scale as ScaleConfigName);
    
    const response: ScaleConfigResponse = {
      scale: scale as ScaleConfigName,
      config: this.scaleConfig,
      previousScale,
      estimatedCapacity: this.getEstimatedCapacity()
    };

    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  }

  async updateScaleConfig(scale: ScaleConfigName) {
    this.scaleConfigName = scale;
    this.scaleConfig = DEFAULT_SCALE_CONFIGS[scale];
    
    const configRecord = await this.globalCounters.where('key', '==', 'scaleConfigName').first();
    if (configRecord) {
      await this.globalCounters.update(configRecord.id, { value: scale });
    } else {
      await this.globalCounters.create({ key: 'scaleConfigName', value: scale });
    }
  }

  private getEstimatedCapacity(): string {
    const totalCapacity = this.scaleConfig.SHARD_COUNT * 1000;
    if (totalCapacity >= 1000000) return `${Math.round(totalCapacity / 1000000)}M+`;
    if (totalCapacity >= 1000) return `${Math.round(totalCapacity / 1000)}K+`;
    return `${totalCapacity}+`;
  }

  async getHealthStatus(): Promise<Response> {
    const [totalUsers, activeShards, serviceConfig] = await Promise.all([
      this.getTotalUsers(),
      this.getAllShards(),
      this.serviceConfigs.where('scaleConfig', '==', this.scaleConfigName).first() || DEFAULT_SERVICE_CONFIG
    ]);

    const health = {
      status: 'healthy' as const,
      timestamp: Date.now(),
      metrics: { totalUsers, activeShards: activeShards.length, scaleConfig: this.scaleConfigName, deliveryRate: 0 },
      config: serviceConfig
    };

    return new Response(JSON.stringify(health), { headers: { 'Content-Type': 'application/json' } });
  }

  async getServiceStats(): Promise<Response> {
    const [totalUsers, activeShards, recentBroadcasts] = await Promise.all([
      this.getTotalUsers(),
      this.getAllShards(),
      this.getRecentBroadcasts(10)
    ]);

    const stats = { totalUsers, activeShards: activeShards.length, scaleConfig: this.scaleConfigName, recentBroadcasts, timestamp: Date.now() };
    return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } });
  }

  private async getRecentBroadcasts(limit: number) {
    const broadcasts = await this.broadcasts.getAll();
    return broadcasts
      .sort((a: any, b: any) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map((broadcast: any) => ({
        broadcastId: broadcast.id,
        status: broadcast.status,
        delivered: broadcast.delivered,
        total: broadcast.total,
        timestamp: broadcast.timestamp
      }));
  }

  // =============================================
  // UTILITY METHODS
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
    return shards.map((shard: any) => shard.shardName);
  }

  private async getTotalUsers(): Promise<number> {
    const counter = await this.globalCounters.where('key', '==', 'totalUsers').first();
    return counter?.value || 0;
  }

  private async markBroadcastFailed(broadcastId: string, error: any) {
    const data = await this.broadcasts.findById(broadcastId);
    if (data) {
      await this.broadcasts.update(broadcastId, { ...data, status: 'failed', error: error.message });
    }
  }
}