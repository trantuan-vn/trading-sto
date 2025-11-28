import { z } from 'zod';
import { GenericTable } from './table.js';

export interface TableOptions {
  userScoped?: boolean;
  organizationScoped?: boolean;
  indexes?: string[];
  autoFields?: {
    id?: boolean;
    timestamps?: boolean;
    user?: boolean;
    organization?: boolean;
  };
  conflictField?: string;
}

export interface TableConfig {
  schema: z.ZodSchema;
  options: TableOptions;
}

export interface DynamicOperation {
  sql: string;
  params: any[];
}

export class DynamicSchemaManager {
  static createInsertOperation(table: string, data: any, schema: z.ZodSchema): DynamicOperation {
    const validatedData = schema.parse(data);
    const fields = Object.keys(validatedData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(field => validatedData[field]);
    
    return {
      sql: `INSERT INTO "${table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${placeholders})`,
      params: values
    };
  }

  static createUpdateOperation(table: string, id: string, data: any, schema: z.ZodSchema): DynamicOperation {
    const validatedData = schema.parse(data);
    const fields = Object.keys(validatedData);
    const setClause = fields.map(field => `"${field}" = ?`).join(', ');
    const values = [...fields.map(field => validatedData[field]), id];
    
    return {
      sql: `UPDATE "${table}" SET ${setClause} WHERE "id" = ?`,
      params: values
    };
  }

  static createUpsertOperation(
    table: string, 
    data: any, 
    conflictField: string, 
    schema: z.ZodSchema
  ): DynamicOperation {
    const validatedData = schema.parse(data);
    const fields = Object.keys(validatedData);
    const placeholders = fields.map(() => '?').join(', ');
    const setClause = fields.map(field => `"${field}" = ?`).join(', ');
    const values = [...Object.values(validatedData), ...Object.values(validatedData)];
    
    return {
      sql: `INSERT INTO "${table}" (${fields.map(f => `"${f}"`).join(', ')}) 
            VALUES (${placeholders}) 
            ON CONFLICT("${conflictField}") 
            DO UPDATE SET ${setClause}`,
      params: values
    };
  }

  static createSelectOperation(
    table: string, 
    where?: { field: string; operator: string; value: any },
    orderBy?: { field: string; direction: 'ASC' | 'DESC' },
    limit?: number
  ): DynamicOperation {
    let sql = `SELECT * FROM "${table}"`;
    const params: any[] = [];

    if (where) {
      sql += ` WHERE "${where.field}" ${where.operator} ?`;
      params.push(where.value);
    }

    if (orderBy) {
      sql += ` ORDER BY "${orderBy.field}" ${orderBy.direction}`;
    }

    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    return { sql, params };
  }

  static createDeleteOperation(
    table: string, 
    where?: { field: string; operator: string; value: any }
  ): DynamicOperation {
    if (where) {
      return {
        sql: `DELETE FROM "${table}" WHERE "${where.field}" ${where.operator} ?`,
        params: [where.value]
      };
    } else {
      throw new Error('Where condition required for delete operation');
    }
  }

  static createDeleteByIdOperation(table: string, id: string): DynamicOperation {
    return {
      sql: `DELETE FROM "${table}" WHERE "id" = ?`,
      params: [id]
    };
  }
}

export class DynamicDataBuilder {
  static buildData(
    data: any, 
    schema: z.ZodSchema, 
    options: TableOptions,
    context: {
      currentUserId?: string;
      organizationId?: string;
      operation?: 'create' | 'update';
    } = {}
  ): any {
    let processedData = { ...data };

    // Auto-generate fields based on configuration
    if (options.autoFields) {
      const now = Date.now();

      if (options.autoFields.id && context.operation === 'create' && !processedData.id) {
        processedData.id = crypto.randomUUID();
      }

      if (options.autoFields.timestamps) {
        if (context.operation === 'create') {
          processedData.created_at = now;
        }
        processedData.updated_at = now;
      }

      if (options.autoFields.user && context.currentUserId) {
        processedData.user_id = context.currentUserId;
      }

      if (options.autoFields.organization && context.organizationId) {
        processedData.organization_id = context.organizationId;
      }
    }

    // Transform data types for SQL storage
    processedData = this.transformData(processedData, schema);

    return schema.parse(processedData);
  }

  private static transformData(data: any, schema: z.ZodSchema): any {
    const transformed = { ...data };
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    Object.keys(transformed).forEach(key => {
      const value = transformed[key];
      const fieldSchema = schemaShape[key];

      if (fieldSchema) {
        // Auto JSON stringify for array/object fields
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          transformed[key] = JSON.stringify(value);
        }
        
        // Convert boolean to integer for SQLite
        if (fieldSchema instanceof z.ZodBoolean && typeof value === 'boolean') {
          transformed[key] = value ? 1 : 0;
        }
        
        // Convert Date to timestamp
        if (fieldSchema instanceof z.ZodDate && value instanceof Date) {
          transformed[key] = value.getTime();
        }
      }
    });

    return transformed;
  }

  static parseFromDatabase(data: any, schema: z.ZodSchema): any {
    if (!data) return data;

    const parsed = { ...data };
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    Object.keys(parsed).forEach(key => {
      const value = parsed[key];
      const fieldSchema = schemaShape[key];

      if (fieldSchema && value !== null) {
        // Parse JSON strings back to objects/arrays
        if (typeof value === 'string') {
          try {
            const potentialJson = JSON.parse(value);
            if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
              parsed[key] = potentialJson;
            }
          } catch {
            // Not JSON, keep as string
          }
        }
        
        // Convert integer back to boolean
        if (fieldSchema instanceof z.ZodBoolean && typeof value === 'number') {
          parsed[key] = Boolean(value);
        }
        
        // Convert timestamp back to Date
        if (fieldSchema instanceof z.ZodDate && typeof value === 'number') {
          parsed[key] = new Date(value);
        }
      }
    });

    return schema.parse(parsed);
  }
}

export class UserDODatabase {  
  private tables = new Map<string, GenericTable<any>>();
  private tableConfigs = new Map<string, TableConfig>();
  private organizationContext?: string;

  constructor(
    private storage: DurableObjectStorage,
    private currentUserId: string,
    private broadcast?: (event: string, data: any) => void
  ) { }

  setOrganizationContext(organizationId?: string): void {
    this.organizationContext = organizationId;
  }

  getTable(name: string): GenericTable<any> | undefined {
    return this.tables.get(name);
  }

  getTableConfig(name: string): TableConfig | undefined {
    return this.tableConfigs.get(name);
  }

  registerTable(name: string, schema: z.ZodSchema, options: TableOptions = {}): void {
    this.tableConfigs.set(name, { schema, options });
    this.ensureTableExists(name, schema, options);
  }

  table<T extends z.ZodSchema>(
    name: string,
    schema: T,
    options: TableOptions = {}
  ): GenericTable<z.infer<T>> {
    if (!this.tables.has(name)) {
      // Register table configuration
      this.registerTable(name, schema, options);
      
      const table = new GenericTable<z.infer<T>>(
        name,
        schema,
        this.storage,
        this.currentUserId,
        () => options.organizationScoped ? this.organizationContext : undefined,
        this.broadcast
      );
      
      this.tables.set(name, table);
    } 
    
    return this.tables.get(name)! as GenericTable<z.infer<T>>;
  }

  // DYNAMIC OPERATIONS METHODS

  async dynamicInsert(tableName: string, data: any): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const processedData = DynamicDataBuilder.buildData(data, config.schema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'create'
    });

    const operation = DynamicSchemaManager.createInsertOperation(
      tableName, 
      processedData, 
      config.schema
    );

    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicUpdate(tableName: string, id: string, data: any): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const processedData = DynamicDataBuilder.buildData(data, config.schema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'update'
    });

    const operation = DynamicSchemaManager.createUpdateOperation(
      tableName, 
      id, 
      processedData, 
      config.schema
    );

    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicUpsert(tableName: string, data: any, conflictField?: string): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const conflictFieldToUse = conflictField || config.options.conflictField;
    if (!conflictFieldToUse) {
      throw new Error(`No conflict field defined for table: ${tableName}`);
    }

    const processedData = DynamicDataBuilder.buildData(data, config.schema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'create'
    });

    const operation = DynamicSchemaManager.createUpsertOperation(
      tableName, 
      processedData, 
      conflictFieldToUse, 
      config.schema
    );

    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicDelete(tableName: string, id: string): Promise<void> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const operation = DynamicSchemaManager.createDeleteByIdOperation(tableName, id);
    await this.execTransaction([operation]);
  }

  async dynamicDeleteWhere(
    tableName: string, 
    where: { field: string; operator: string; value: any }
  ): Promise<void> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const operation = DynamicSchemaManager.createDeleteOperation(tableName, where);
    await this.execTransaction([operation]);
  }

  async dynamicSelect(
    tableName: string, 
    where?: { field: string; operator: string; value: any },
    orderBy?: { field: string; direction: 'ASC' | 'DESC' },
    limit?: number
  ): Promise<any[]> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const operation = DynamicSchemaManager.createSelectOperation(
      tableName, 
      where, 
      orderBy, 
      limit
    );

    const results = await this.execSelectSQL(operation.sql, operation.params);
    
    // Parse results back to validated objects
    return results.map(row => 
      DynamicDataBuilder.parseFromDatabase(row, config.schema)
    );
  }

  async dynamicBatchInsert(tableName: string, dataArray: any[]): Promise<any[]> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }

    const operations: DynamicOperation[] = [];
    const results: any[] = [];

    for (const data of dataArray) {
      const processedData = DynamicDataBuilder.buildData(data, config.schema, config.options, {
        currentUserId: this.currentUserId,
        organizationId: this.organizationContext,
        operation: 'create'
      });

      const operation = DynamicSchemaManager.createInsertOperation(
        tableName, 
        processedData, 
        config.schema
      );

      operations.push(operation);
      results.push(processedData);
    }

    await this.execTransaction(operations);
    return results;
  }

  // BATCH OPERATIONS WITH MULTIPLE TABLES
  async dynamicMultiTableTransaction(operations: Array<{
    table: string;
    operation: 'insert' | 'update' | 'upsert' | 'delete';
    data?: any;
    id?: string;
    conflictField?: string;
    where?: { field: string; operator: string; value: any };
  }>): Promise<any[]> {
    const sqlOperations: DynamicOperation[] = [];
    const results: any[] = [];

    for (const op of operations) {
      const config = this.tableConfigs.get(op.table);
      if (!config) {
        throw new Error(`Table ${op.table} not registered`);
      }

      let sqlOp: DynamicOperation;

      switch (op.operation) {
        case 'insert':
          if (!op.data) throw new Error('Data required for insert operation');
          const insertData = DynamicDataBuilder.buildData(op.data, config.schema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'create'
          });
          sqlOp = DynamicSchemaManager.createInsertOperation(op.table, insertData, config.schema);
          results.push(insertData);
          break;

        case 'update':
          if (!op.id) throw new Error('ID required for update operation');
          if (!op.data) throw new Error('Data required for update operation');
          const updateData = DynamicDataBuilder.buildData(op.data, config.schema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'update'
          });
          sqlOp = DynamicSchemaManager.createUpdateOperation(op.table, op.id, updateData, config.schema);
          results.push(updateData);
          break;

        case 'upsert':
          if (!op.data) throw new Error('Data required for upsert operation');
          const upsertData = DynamicDataBuilder.buildData(op.data, config.schema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'create'
          });
          const conflictField = op.conflictField || config.options.conflictField;
          if (!conflictField) throw new Error('Conflict field required for upsert operation');
          sqlOp = DynamicSchemaManager.createUpsertOperation(op.table, upsertData, conflictField, config.schema);
          results.push(upsertData);
          break;

        case 'delete':
          if (op.id) {
            // Delete by ID
            sqlOp = DynamicSchemaManager.createDeleteByIdOperation(op.table, op.id);
            results.push({ id: op.id, deleted: true });
          } else if (op.where) {
            // Delete by condition
            sqlOp = DynamicSchemaManager.createDeleteOperation(op.table, op.where);
            results.push({ where: op.where, deleted: true });
          } else {
            throw new Error('ID or where condition required for delete operation');
          }
          break;

        default:
          throw new Error(`Unknown operation: ${op.operation}`);
      }

      sqlOperations.push(sqlOp);
    }

    await this.execTransaction(sqlOperations);
    return results;
  }

  // EXISTING METHODS (with minor improvements)

  get raw() {
    return this.storage.sql;
  } 

  private ensureTableExists(name: string, schema: z.ZodSchema, options: TableOptions): void {
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};
    const columns = this.buildColumnDefinitions(schemaShape, options);

    const createSQL = `CREATE TABLE IF NOT EXISTS "${name}" (
      ${columns.join(',\n      ')}
    )`;

    try {
      this.storage.sql.exec(createSQL);
      this.createIndexes(name, options.indexes || []);
    } catch (err) {
      throw new Error(`Failed to create table ${name}: ${err}`);
    }
  }

  private buildColumnDefinitions(schemaShape: any, options: TableOptions): string[] {
    const columns: string[] = [];

    // Add auto fields based on configuration
    if (options.autoFields?.id !== false) {
      columns.push('"id" TEXT PRIMARY KEY');
    }

    if (options.autoFields?.timestamps !== false) {
      columns.push('"created_at" INTEGER NOT NULL');
      columns.push('"updated_at" INTEGER NOT NULL');
    }

    if (options.autoFields?.user !== false) {
      if (options.userScoped) {
        columns.push('"user_id" TEXT NOT NULL');
      } else {
        columns.push('"user_id" TEXT');
      }
    }

    if (options.autoFields?.organization !== false) {
      if (options.organizationScoped) {
        columns.push('"organization_id" TEXT NOT NULL');
      } else {
        columns.push('"organization_id" TEXT');
      }
    }

    // Add columns from schema
    for (const [key, value] of Object.entries(schemaShape)) {
      const columnType = this.getColumnType(value as z.ZodTypeAny);
      columns.push(`"${key}" ${columnType}`);
    }

    return columns;
  }

  private getColumnType(zodType: z.ZodTypeAny): string {
    // Simplified type mapping - the actual transformation happens in DynamicDataBuilder
    if (zodType instanceof z.ZodString || zodType instanceof z.ZodEnum) {
      return 'TEXT';
    } else if (zodType instanceof z.ZodNumber) {
      return 'REAL';
    } else if (zodType instanceof z.ZodBoolean) {
      return 'INTEGER';
    } else if (zodType instanceof z.ZodDate) {
      return 'INTEGER';
    } else if (zodType instanceof z.ZodArray || zodType instanceof z.ZodObject) {
      return 'TEXT';
    } else if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
      return this.getColumnType(zodType._def.innerType);
    } else if (zodType instanceof z.ZodDefault) {
      return this.getColumnType(zodType._def.innerType);
    } else {
      return 'TEXT';
    }
  }

  private createIndexes(tableName: string, indexes: string[]): void {
    // Create custom indexes
    for (const index of indexes) {
      try {
        const indexSQL = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${index}" ON "${tableName}" ("${index}")`;
        this.storage.sql.exec(indexSQL);
      } catch (err) {
        console.warn(`Failed to create index on ${tableName}.${index}:`, err);
      }
    }

    // Create auto indexes for common fields
    const autoIndexFields = ['user_id', 'organization_id', 'created_at'];
    for (const field of autoIndexFields) {
      try {
        const indexSQL = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${field}" ON "${tableName}" ("${field}")`;
        this.storage.sql.exec(indexSQL);
      } catch (err) {
        console.warn(`Failed to create ${field} index on ${tableName}:`, err);
      }
    }
  }

  async execTransaction(operations: Array<{ sql: string; params?: any[] }>): Promise<void> {
    if (!operations.length) {
      throw new Error('Empty transaction');
    }    
    await this.storage.transactionSync(async () => {
      for (const op of operations) {
        this.storage.sql.exec(op.sql, ...(op.params || []));
      }        
    });
  }

  async execSelectSQL(sql: string, params: any[] = []): Promise<any[]> {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT statements are allowed in execSelectSQL');
    }      
    const cursor = this.storage.sql.exec(sql, ...params);
    const result = cursor.toArray();
    return result;
  }

  // Method to drop table (for testing/cleanup)
  async dropTable(name: string): Promise<void> {
    const dropSQL = `DROP TABLE IF EXISTS "${name}"`;
    this.storage.sql.exec(dropSQL);
    this.tables.delete(name);
    this.tableConfigs.delete(name);
  }

  // Get all registered table names
  getRegisteredTables(): string[] {
    return Array.from(this.tableConfigs.keys());
  }
}