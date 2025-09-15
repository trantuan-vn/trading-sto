import { Storage } from 'wagmi';

export class D1Storage implements Storage {
  private db: any;
  public key: string;

  constructor({ database, key = 'wagmi' }: { database: any; key?: string }) {
    this.db = database;
    this.key = key;
  }

  async getItem<key extends string = string>(key: key) {
    const fullKey = `${this.key}:${key}`;
    const result = await this.db
      .prepare('SELECT value FROM wagmi_storage WHERE key = ?')
      .bind(fullKey)
      .first();

    if (!result) return null;

    try {
      return JSON.parse(result.value);
    } catch {
      return result.value;
    }
  }

  async setItem<key extends string = string>(key: key, value: any) {
    const fullKey = `${this.key}:${key}`;
    const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);

    await this.db
      .prepare('INSERT OR REPLACE INTO wagmi_storage (key, value) VALUES (?, ?)')
      .bind(fullKey, valueToStore)
      .run();
  }

  async removeItem<key extends string = string>(key: key) {
    const fullKey = `${this.key}:${key}`;
    await this.db
      .prepare('DELETE FROM wagmi_storage WHERE key = ?')
      .bind(fullKey)
      .run();
  }
}