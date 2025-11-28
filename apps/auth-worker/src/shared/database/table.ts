import { z } from 'zod';
import { GenericQuery } from './query.js';

// Type alias for better DX
export type Table<T = any> = GenericTable<T>;

export class GenericTable<T = any> {
  constructor(
    private tableName: string,
    private schema: z.ZodSchema<T>,
    private storage: DurableObjectStorage,
    private userId: string,
    private getOrganizationContext: () => string | undefined,
    private broadcast?: (event: string, data: any) => void
  ) { }

  private get organizationContext(): string | undefined {
    return this.getOrganizationContext();
  }

  // Helper method to extract column names and values from validated data
  private extractColumnsAndValues(data: T): { columns: string[]; values: any[]; placeholders: string[] } {
    const columns = ['id', 'created_at', 'updated_at', 'user_id'];
    const values: any[] = [];
    const placeholders: string[] = [];

    // Add organization_id if context exists
    if (this.organizationContext) {
      columns.push('organization_id');
    }

    // Extract all properties from the data object - handle z.infer types
    const dataObj = data as Record<string, any>;
    for (const [key, value] of Object.entries(dataObj)) {
      columns.push(key);
      values.push(value);
    }

    // Generate placeholders for SQL (?, ?, ?, ...)
    for (let i = 0; i < columns.length; i++) {
      placeholders.push('?');
    }

    return { columns, values, placeholders };
  }

  // Helper method to build WHERE clause for user/organization context
  private buildWhereClause(): { whereClause: string; params: any[] } {
    if (this.organizationContext) {
      return {
        whereClause: 'WHERE user_id = ? AND organization_id = ?',
        params: [this.userId, this.organizationContext]
      };
    } else {
      return {
        whereClause: 'WHERE user_id = ?',
        params: [this.userId]
      };
    }
  }

  async create(data: T): Promise<T & { id: string; createdAt: Date; updatedAt: Date }> {
    const validated = this.schema.parse(data);
    
    const id = crypto.randomUUID();
    const now = Date.now();
    
    const { columns, values, placeholders } = this.extractColumnsAndValues(validated);
    
    // Set the fixed values (id, timestamps, user_id, organization_id)
    const allValues: any[] = [id, now, now, this.userId];
    if (this.organizationContext) {
      allValues.push(this.organizationContext);
    }
    
    // Add the validated data values
    allValues.push(...values);

    const insertSQL = `INSERT INTO "${this.tableName}" (${columns.map(col => `"${col}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;

    try {
      this.storage.sql.exec(insertSQL, ...allValues);
    } catch (error) {
      throw error;
    }

    const result = { 
      ...validated, 
      id, 
      createdAt: new Date(now), 
      updatedAt: new Date(now) 
    };

    // Broadcast the creation event
    this.broadcastToUser(`table:${this.tableName}`, { type: 'create', data: result });
        
    return result;
  }  

  async findById(id: string): Promise<(T & { id: string; createdAt: Date; updatedAt: Date }) | null> {
    const { whereClause, params } = this.buildWhereClause();
    const selectSQL = `SELECT * FROM "${this.tableName}" ${whereClause} AND id = ? LIMIT 1`;
    
    const cursor = this.storage.sql.exec(selectSQL, ...params, id);
    const results = cursor.toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return this.mapRowToResult(row);
  }

  // Helper method to map database row to result object
  private mapRowToResult(row: any): T & { id: string; createdAt: Date; updatedAt: Date } {
    const result: any = {
      id: row.id as string,
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number)
    };

    // Copy all other columns (excluding system columns) to the result
    const systemColumns = ['id', 'created_at', 'updated_at', 'user_id', 'organization_id'];
    for (const [key, value] of Object.entries(row)) {
      if (!systemColumns.includes(key)) {
        result[key] = value;
      }
    }

    return result as T & { id: string; createdAt: Date; updatedAt: Date };
  }

  async update(id: string, updates: Partial<T>): Promise<T & { id: string; createdAt: Date; updatedAt: Date }> {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Record not found');

    // Merge updates with existing data
    const merged = { ...existing, ...updates };
    delete (merged as any).id;
    delete (merged as any).createdAt;
    delete (merged as any).updatedAt;

    const validated = this.schema.parse(merged);
    const now = Date.now();

    const { whereClause, params } = this.buildWhereClause();
    
    // Build SET clause for update
    const setClauses: string[] = ['updated_at = ?'];
    const updateParams: any[] = [now];

    // Add all validated fields to SET clause - handle z.infer types
    const validatedData = validated as Record<string, any>;
    for (const [key, value] of Object.entries(validatedData)) {
      setClauses.push(`"${key}" = ?`);
      updateParams.push(value);
    }

    const updateSQL = `UPDATE "${this.tableName}" SET ${setClauses.join(', ')} ${whereClause} AND id = ?`;
    
    this.storage.sql.exec(updateSQL, ...updateParams, ...params, id);

    const result = { ...validated, id, createdAt: existing.createdAt, updatedAt: new Date(now) };

    // Broadcast the update event
    this.broadcastToUser(`table:${this.tableName}`, { type: 'update', data: result });

    return result;
  }

  async delete(id: string): Promise<void> {
    const { whereClause, params } = this.buildWhereClause();
    const deleteSQL = `DELETE FROM "${this.tableName}" ${whereClause} AND id = ?`;
    
    this.storage.sql.exec(deleteSQL, ...params, id);

    // Broadcast the delete event
    this.broadcastToUser(`table:${this.tableName}`, { type: 'delete', data: { id } });
  }

  where(path: string, operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'includes' | 'in', value: any): GenericQuery<T> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).where(path, operator, value);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): GenericQuery<T> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).orderBy(field, direction);
  }

  limit(count: number): GenericQuery<T> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).limit(count);
  }

  async getAll(): Promise<Array<T & { id: string; createdAt: Date; updatedAt: Date }>> {
    return new GenericQuery<T>(this.tableName, this.storage, this.schema, this.userId, this.getOrganizationContext).get();
  }

  async count(): Promise<number> {
    const { whereClause, params } = this.buildWhereClause();
    const sql = `SELECT COUNT(*) as count FROM "${this.tableName}" ${whereClause}`;

    const cursor = this.storage.sql.exec(sql, ...params);
    const results = cursor.toArray();
    return results.length > 0 ? Number(results[0].count) : 0;
  }

  // ============ BROADCAST METHODS ============   
  broadcastToUser(event: string, data: any) {
    this.broadcast?.(event, data);
  }
}