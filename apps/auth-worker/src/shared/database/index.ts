import { z } from 'zod';
import { GenericTable } from './table.js';

export interface TableOptions {
  userScoped?: boolean;
  organizationScoped?: boolean;
  indexes?: string[];
  uniqueIndexes?: string[]; // Thêm unique indexes
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
  static createInsertOperation(table: string, data: any): DynamicOperation {
    
    const fields = Object.keys(data);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(field => data[field]);
    
    return {
      sql: `INSERT INTO "${table}" (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${placeholders})`,
      params: values
    };
  }

  static createUpdateOperation(
    table: string, 
    id: string, 
    data: any, 
  ): DynamicOperation {
      
      const fields = Object.keys(data);
      const setClause = fields.map(field => `"${field}" = ?`).join(', ');
      const values = [...fields.map(field => data[field]), id];
      
      return {
        sql: `UPDATE "${table}" SET ${setClause} WHERE "id" = ?`,
        params: values
      };
  }

  static createUpsertOperation(
      table: string, 
      data: any, 
      conflictField: string
  ): DynamicOperation {
      
      const insertFields = Object.keys(data);
      const insertPlace = insertFields.map(() => '?').join(', ');
      
      // Tạo SET clause cho các trường cần update (trừ conflictField)
      const updateFields = insertFields.filter(
        field => field !== conflictField &&
                !['id', 'user_id', 'organization_id', 'created_at'].includes(field)
      );

      // Sử dụng excluded values cho UPDATE
      const setUpdateClause = updateFields.map(field => `"${field}" = ?`).join(', ');
      
      // Tạo values cho INSERT, UPDATE
      let values = insertFields.map(field => data[field]);
      values.push(...updateFields.map(field => data[field]));
      
      return {
        sql: `INSERT INTO "${table}" (${insertFields.map(f => `"${f}"`).join(', ')}) 
              VALUES (${insertPlace}) 
              ON CONFLICT("${conflictField}") 
              DO UPDATE SET ${setUpdateClause}`,
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
class SchemaTypeChecker {
  // Factory method tạo các checker cụ thể
  static isNumberSchema = SchemaTypeChecker.createChecker(z.ZodNumber);
  static isDateSchema = SchemaTypeChecker.createChecker(z.ZodDate);
  static isBooleanSchema = SchemaTypeChecker.createChecker(z.ZodBoolean);
  static isStringSchema = SchemaTypeChecker.createChecker(z.ZodString);  
  static isArraySchema = SchemaTypeChecker.createChecker(z.ZodArray);
  static isObjectSchema = SchemaTypeChecker.createChecker(z.ZodObject);
  static isEnumSchema = SchemaTypeChecker.createChecker(z.ZodEnum);
  static isNativeEnumSchema = SchemaTypeChecker.createChecker(z.ZodNativeEnum);
  static isUnionSchema = SchemaTypeChecker.createChecker(z.ZodUnion);
  static isIntersectionSchema = SchemaTypeChecker.createChecker(z.ZodIntersection);    
  private static createChecker<T extends z.ZodTypeAny>(targetType: abstract new (...args: any[]) => T) {
    return (schema: z.ZodTypeAny): boolean => {
      if (schema instanceof targetType) return true;
      
      const innerSchema = this.getInnerSchema(schema);
      return innerSchema ? this.createChecker(targetType)(innerSchema) : false;
    };
  }
  
  private static getInnerSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
    if (schema instanceof z.ZodOptional || 
        schema instanceof z.ZodNullable || 
        schema instanceof z.ZodDefault) {
      return schema._def.innerType;
    } 
    else if (schema instanceof z.ZodEffects) {
      return schema._def.schema;
    }
    else if (schema instanceof z.ZodPipeline) {
      return schema._def.in;
    }
    return undefined;
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
    let processedData = schema.parse(data);

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

    return processedData;
  }

  private static transformData(data: any, schema: z.ZodSchema): any {
    const transformed = { ...data };
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    Object.keys(transformed).forEach(key => {
      const value = transformed[key];
      const fieldSchema = schemaShape[key];

      if (fieldSchema) {
        // Auto JSON stringify for array/object fields
        if (this.isObjectLikeSchema(fieldSchema) && typeof value === 'string') {
          transformed[key] = JSON.stringify(value);
        }
        
        // Convert boolean to integer for SQLite (nhất quán với parseFromDatabase)
        if (SchemaTypeChecker.isBooleanSchema(fieldSchema) && typeof value === 'boolean') {
          transformed[key] = value ? 1 : 0;
        }
        
        // Convert Date to timestamp
        if (SchemaTypeChecker.isDateSchema(fieldSchema) && value instanceof Date) {
          transformed[key] = value.getTime();
        }

        // Đảm bảo number được lưu đúng
        if (SchemaTypeChecker.isNumberSchema(fieldSchema) && typeof value === 'string') {
          const num = Number(value);
          if (!isNaN(num)) {
            transformed[key] = num;
          }
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

      if (fieldSchema && value !== null && value !== undefined) {
        // Xử lý object/array từ JSON string - kiểm tra nếu schema là object/array
        if (typeof value === 'string' && this.isObjectLikeSchema(fieldSchema)) {
          try {
            const potentialJson = JSON.parse(value);
            // Chỉ parse nếu kết quả là object hoặc array
            if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
              parsed[key] = potentialJson;
            }
          } catch {
            // Not JSON, keep as string và tiếp tục xử lý các type khác
          }
        }
        
        // Xử lý boolean - chuyển đổi 1/0 (integer) thành true/false (boolean)
        if (SchemaTypeChecker.isBooleanSchema(fieldSchema)) {
          if (typeof value === 'number') {
            // 1 -> true, 0 -> false
            parsed[key] = value === 1;
          } else if (typeof value === 'string') {
            // '1' -> true, '0' -> false
            parsed[key] = value === '1';
          }
        }
        
        // Xử lý number - chuyển đổi string thành number
        if (SchemaTypeChecker.isNumberSchema(fieldSchema)) {
          if (typeof value === 'string') {
            const num = Number(value);
            if (!isNaN(num)) {
              parsed[key] = num;
            }
          }
        }
        
        // Xử lý date - chuyển đổi timestamp (number) hoặc string thành Date
        if (SchemaTypeChecker.isDateSchema(fieldSchema)) {
          if (typeof value === 'number') {
            parsed[key] = new Date(value);
          } else if (typeof value === 'string') {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              parsed[key] = date;
            }
          }
        }        
      }
    });

    return schema.parse(parsed);
  }

  // Helper methods
  private static isObjectLikeSchema(schema: z.ZodTypeAny): boolean {
    // Kiểm tra nếu schema là object hoặc array (có thể chứa JSON)
    return SchemaTypeChecker.isObjectSchema(schema) || SchemaTypeChecker.isArraySchema(schema);
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

  createExtendedSchema(
    baseSchema: z.ZodSchema, 
    options: TableOptions
  ): z.ZodSchema {
    let extendedSchema = baseSchema;

    // Thêm auto fields vào schema
    if (options.autoFields) {
      const extensions: any = {};

      if (options.autoFields.id) {
        extensions.id = z.string().optional();
      }

      if (options.autoFields.timestamps) {
        extensions.created_at = z.number().optional();
        extensions.updated_at = z.number().optional();
      }

      if (options.autoFields.user) {
        extensions.user_id = z.string().optional();
      }

      if (options.autoFields.organization) {
        extensions.organization_id = z.string().optional();
      }

      extendedSchema = (baseSchema as any).extend(extensions);
    }

    return extendedSchema;
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
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);
    const processedData = DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'create'
    });

    const operation = DynamicSchemaManager.createInsertOperation(
      tableName, 
      processedData
    );

    await this.execTransaction([operation]);
    return processedData;
  }

  async dynamicUpdate(tableName: string, id: string, data: any): Promise<any> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const idData = await this.dynamicSelect(tableName, { field: 'id', operator: '=', value: id });
    if (idData.length === 0) {
      throw new Error(`No record found with id: ${id}`);
    }
    const updateData = { ...idData[0], ...data };
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const processedData = DynamicDataBuilder.buildData(updateData, extendedSchema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'update'
    });
    const operation = DynamicSchemaManager.createUpdateOperation(
      tableName, 
      id, 
      processedData
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

    const extendedSchema = this.createExtendedSchema(config.schema, config.options);
    const processedData = DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
      currentUserId: this.currentUserId,
      organizationId: this.organizationContext,
      operation: 'create'
    });

    const operation = DynamicSchemaManager.createUpsertOperation(
      tableName, 
      processedData, 
      conflictFieldToUse
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
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const operation = DynamicSchemaManager.createSelectOperation(
      tableName, 
      where, 
      orderBy, 
      limit
    );

    const results = await this.execSelectSQL(operation.sql, operation.params);        

    // Parse results back to validated objects
    return results.map(row => 
      DynamicDataBuilder.parseFromDatabase(row, extendedSchema)
    );
  }

  async dynamicBatchInsert(tableName: string, dataArray: any[]): Promise<any[]> {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not registered`);
    }
    const extendedSchema = this.createExtendedSchema(config.schema, config.options);

    const operations: DynamicOperation[] = [];
    const results: any[] = [];
    
    for (const data of dataArray) {
      
      const processedData = DynamicDataBuilder.buildData(data, extendedSchema, config.options, {
        currentUserId: this.currentUserId,
        organizationId: this.organizationContext,
        operation: 'create'
      });

      const operation = DynamicSchemaManager.createInsertOperation(
        tableName, 
        processedData
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

      const extendedSchema = this.createExtendedSchema(config.schema, config.options);

      switch (op.operation) {
        case 'insert':
          if (!op.data) throw new Error('Data required for insert operation');
          const insertData = DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'create'
          });
          sqlOp = DynamicSchemaManager.createInsertOperation(op.table, insertData);
          results.push(insertData);
          break;

        case 'update':
          if (!op.id) throw new Error('ID required for update operation');
          if (!op.data) throw new Error('Data required for update operation');          
          const updateData = DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'update'
          });
          sqlOp = DynamicSchemaManager.createUpdateOperation(op.table, op.id, updateData);
          results.push(updateData);
          break;

        case 'upsert':
          if (!op.data) throw new Error('Data required for upsert operation');
          const upsertData = DynamicDataBuilder.buildData(op.data, extendedSchema, config.options, {
            currentUserId: this.currentUserId,
            organizationId: this.organizationContext,
            operation: 'create'
          });
          const conflictField = op.conflictField || config.options.conflictField;
          if (!conflictField) throw new Error('Conflict field required for upsert operation');
          sqlOp = DynamicSchemaManager.createUpsertOperation(op.table, upsertData, conflictField);
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
      this.createIndexes(name, options);
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

    // Add UNIQUE constraints for conflictField
    if (options.conflictField) {
      columns.push(`UNIQUE("${options.conflictField}")`);
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

  private createIndexes(tableName: string, options: TableOptions): void {
    // Create regular indexes
    for (const index of options.indexes || []) {
      const indexSQL = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${index}" ON "${tableName}" ("${index}")`;
      this.storage.sql.exec(indexSQL);
    }

    // Create unique indexes
    for (const uniqueIndex of options.uniqueIndexes || []) {
      const uniqueIndexSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_${uniqueIndex}" ON "${tableName}" ("${uniqueIndex}")`;
      this.storage.sql.exec(uniqueIndexSQL);
    }

    // Create composite unique indexes for user/organization scoped tables
    if (options.userScoped && options.organizationScoped) {
      const compositeUniqueSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_user_org" ON "${tableName}" ("user_id", "organization_id")`;
      this.storage.sql.exec(compositeUniqueSQL);
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

  // Method to check if unique constraint violation occurred
  isUniqueConstraintError(error: any): boolean {
    return error instanceof Error && (
      error.message.includes('UNIQUE constraint failed') ||
      error.message.includes('constraint failed') ||
      error.message.includes('unique constraint') ||
      error.message.includes('Duplicate entry')
    );
  }

  // Method to get unique constraint details
  getUniqueConstraintDetails(tableName: string): string[] {
    const config = this.tableConfigs.get(tableName);
    if (!config) return [];

    const uniqueFields: string[] = [];

    // Add conflictField as unique
    if (config.options.conflictField) {
      uniqueFields.push(config.options.conflictField);
    }

    // Add uniqueIndexes
    if (config.options.uniqueIndexes) {
      uniqueFields.push(...config.options.uniqueIndexes);
    }

    // Add composite unique for user/org scoped tables
    if (config.options.userScoped && config.options.organizationScoped) {
      uniqueFields.push('user_id,organization_id');
    }

    return uniqueFields;
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

  // Get table schema information
  getTableInfo(tableName: string): {
    columns: string[];
    indexes: string[];
    uniqueIndexes: string[];
    conflictField?: string;
  } {
    const config = this.tableConfigs.get(tableName);
    if (!config) {
      throw new Error(`Table ${tableName} not found`);
    }

    const schemaShape = config.schema instanceof z.ZodObject ? config.schema.shape : {};
    const columns = Object.keys(schemaShape);

    // Add auto fields
    if (config.options.autoFields?.id !== false) columns.push('id');
    if (config.options.autoFields?.timestamps !== false) {
      columns.push('created_at', 'updated_at');
    }
    if (config.options.autoFields?.user !== false) columns.push('user_id');
    if (config.options.autoFields?.organization !== false) columns.push('organization_id');

    return {
      columns,
      indexes: config.options.indexes || [],
      uniqueIndexes: config.options.uniqueIndexes || [],
      conflictField: config.options.conflictField
    };
  }
}