import { DurableObject } from 'cloudflare:workers';
export class UserShardDO extends DurableObject {
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.storage = state.storage;
    this.state.blockConcurrencyWhile(async () => {
      const users = await this.storage.get('users');
      if (!users) {
        await this.storage.put('users', JSON.stringify(new Array<string>()));
      }
    });
    
  }

  async registerUser(userId: string) {
    await this.storage.transaction(async (txn) => {
      let usersStr = await txn.get('users');
      let users: Set<string> = new Set(); // Tối ưu: Sử dụng Set để tránh duplicates
      try {
        const usersJson = typeof usersStr === 'string' ? usersStr : '[]';
        users = new Set(JSON.parse(usersJson));
      } catch (e) {
        console.error('Failed to parse users for register:', e);
      }
      if (!users.has(userId)) {
        users.add(userId);
        await txn.put('users', JSON.stringify(Array.from(users)));
      }
    });
  }

  async unregisterUser(userId: string) {
    await this.storage.transaction(async (txn) => {
      let usersStr = await txn.get('users');
      let users: Set<string> = new Set();
      try {
        const usersJson = typeof usersStr === 'string' ? usersStr : '[]';
        users = new Set(JSON.parse(usersJson));
      } catch (e) {}
      users.delete(userId);
      await txn.put('users', JSON.stringify(Array.from(users)));
    });
  }

  async triggerBroadcast(broadcastId: string) {
    let usersStr = await this.storage.get('users');
    let users: string[] = [];
    try {
      const jsonStr = typeof usersStr === 'string' ? usersStr : '[]';
      users = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse users for broadcast:', e);
      return;
    }
    
    console.log(`Triggering broadcast to ${users.length} users in shard`);

    // Process users in batches with staggered alarms
    const BATCH_SIZE = 100;
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      
      // Set alarms for this batch with staggered timing
      this.state.waitUntil(this.setBatchAlarms(batch, broadcastId, i / BATCH_SIZE));
      
      // Delay between batches to spread load
      if (i + BATCH_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
  }

  private async setBatchAlarms(userBatch: string[], broadcastId: string, batchIndex: number) {
    const baseDelay = batchIndex * 30000; // 30 seconds between batches
    
    for (const userId of userBatch) {
      try {
        const userDO = this.env.USER_DO.get(
          this.env.USER_DO.idFromName(userId)
        );
        
        // Stagger alarms within batch (0-30 seconds)
        const staggerDelay = Math.random() * 30000;
        const alarmTime = Date.now() + baseDelay + staggerDelay;
        
        await userDO.setAlarm(alarmTime, broadcastId);
      } catch (error) {
        console.error(`Failed to set alarm for user ${userId}:`, error);
      }
    }
  }

  async getUsers() {
    let usersStr = await this.storage.get('users');
    try {
      const jsonStr = typeof usersStr === 'string' ? usersStr : '[]';
      return JSON.parse(jsonStr);
    } catch (e) {
      return [];
    }
  }
}