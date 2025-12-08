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
    const preprocessedData = this.preprocessData(data, schema);
    let processedData = schema.parse(preprocessedData);

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
        if (this.isObjectLikeSchema(fieldSchema) && value !== null && value !== undefined) {
          if (typeof value === 'object' || Array.isArray(value)) {
            transformed[key] = JSON.stringify(value);
          }
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

/**
   * Preprocess data to parse JSON strings and convert types before validation
   * Handles: JSON strings, nested objects/arrays, boolean/number/date conversions
   */
  private static preprocessData(data: any, schema: z.ZodSchema): any {
    if (!data) return data;
    
    // Handle arrays - preprocess each element
    if (Array.isArray(data)) {
      return data.map(item => this.preprocessData(item, schema));
    }
    
    // Handle non-object types
    if (typeof data !== 'object') return data;

    const preprocessed = { ...data };
    const schemaShape = schema instanceof z.ZodObject ? schema.shape : {};

    Object.keys(preprocessed).forEach(key => {
      const value = preprocessed[key];
      const fieldSchema = this.unwrapOptionalSchema(schemaShape[key]);

      if (fieldSchema && value !== null && value !== undefined) {
        // 1. Parse JSON strings for object/array fields
        if (typeof value === 'string' && this.isObjectLikeSchema(fieldSchema)) {
          try {
            const potentialJson = JSON.parse(value);
            // Only parse if result is object or array
            if (Array.isArray(potentialJson) || typeof potentialJson === 'object') {
              preprocessed[key] = this.preprocessData(potentialJson, fieldSchema);
            }
          } catch {
            // Not valid JSON, keep as string
          }
        }
        
        // 2. Handle nested objects/arrays - recursively preprocess
        if (typeof value === 'object' && this.isObjectLikeSchema(fieldSchema)) {
          if (Array.isArray(value)) {
            // Array of items - preprocess each item if schema has element type
            const elementSchema = this.getArrayElementSchema(fieldSchema);
            if (elementSchema) {
              preprocessed[key] = value.map(item => 
                typeof item === 'string' && this.isObjectLikeSchema(elementSchema)
                  ? this.tryParseJson(item, elementSchema)
                  : this.preprocessData(item, elementSchema)
              );
            }
          } else {
            // Nested object - recursively preprocess
            preprocessed[key] = this.preprocessData(value, fieldSchema);
          }
        }
        
        // 3. Convert boolean from number/string (1/0, '1'/'0', 'true'/'false')
        if (SchemaTypeChecker.isBooleanSchema(fieldSchema)) {
          if (typeof value === 'number') {
            preprocessed[key] = value === 1;
          } else if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === '1' || lower === 'true') {
              preprocessed[key] = true;
            } else if (lower === '0' || lower === 'false') {
              preprocessed[key] = false;
            }
          }
        }
        
        // 4. Convert number from string
        if (SchemaTypeChecker.isNumberSchema(fieldSchema)) {
          if (typeof value === 'string') {
            const num = Number(value);
            if (!isNaN(num) && value.trim() !== '') {
              preprocessed[key] = num;
            }
          }
        }
        
        // 5. Convert date from string/timestamp
        if (SchemaTypeChecker.isDateSchema(fieldSchema)) {
          if (typeof value === 'number') {
            preprocessed[key] = new Date(value);
          } else if (typeof value === 'string') {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              preprocessed[key] = date;
            }
          }
        }
      }
    });

    return preprocessed;
  }

  /**
   * Unwrap optional schema to get the inner type
   */
  private static unwrapOptionalSchema(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
    if (!schema) return undefined;
    
    // Handle ZodOptional
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return schema._def.innerType;
    }
    
    // Handle ZodDefault
    if (schema instanceof z.ZodDefault) {
      return schema._def.innerType;
    }
    
    return schema;
  }

  /**
   * Get element schema from array schema
   */
  private static getArrayElementSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
    if (schema instanceof z.ZodArray) {
      return schema._def.type;
    }
    
    // Handle optional/nullable arrays
    const unwrapped = this.unwrapOptionalSchema(schema);
    if (unwrapped instanceof z.ZodArray) {
      return unwrapped._def.type;
    }
    
    return undefined;
  }

  /**
   * Try to parse JSON string and preprocess if successful
   */
  private static tryParseJson(value: string, schema: z.ZodTypeAny): any {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) || typeof parsed === 'object') {
        return this.preprocessData(parsed, schema);
      }
    } catch {
      // Not valid JSON
    }
    return value;
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
    const schemaShape = this.extractSchemaShape(schema);
    const columns = this.buildColumnDefinitions(schemaShape, options);

    const createSQL = `CREATE TABLE IF NOT EXISTS "${name}" (
      ${columns.join(',\n      ')}
    )`;

    try {
      this.storage.sql.exec(createSQL);      
    } catch (err) {
      console.error(`Error in ensureTableExists, sql: ${createSQL}`);
      throw err;
    }
    this.createIndexes(name, options);
  }
  private extractSchemaShape(schema: z.ZodSchema): Record<string, z.ZodTypeAny> {
    // Base case: ZodObject
    if (schema instanceof z.ZodObject) {
      return schema.shape;
    }
    
    // ZodEffects từ .refine(), .transform(), etc.
    if (schema instanceof z.ZodEffects) {
      return this.extractSchemaShape(schema._def.schema);
    }
    
    // ZodOptional, ZodDefault, ZodNullable
    if (schema instanceof z.ZodOptional || 
        schema instanceof z.ZodDefault || 
        schema instanceof z.ZodNullable) {
      return this.extractSchemaShape(schema._def.innerType);
    }
    
    // ZodArray
    if (schema instanceof z.ZodArray) {
      return this.extractSchemaShape(schema._def.type);
    }
    
    // ZodRecord, ZodMap, etc. (nếu cần)
    if (schema instanceof z.ZodRecord) {
      return {};
    }
    
    throw new Error(`Unsupported Zod schema type: ${schema.constructor.name}`);
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
    // Recursively unwrap Zod types
    const unwrappedType = this.unwrapZodType(zodType);
        
    // Map to SQLite types
    if (unwrappedType instanceof z.ZodString) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodNumber) {
      return this.isIntegerType(unwrappedType) ? 'INTEGER' : 'REAL';
    } else if (unwrappedType instanceof z.ZodBoolean) {
      return 'INTEGER';
    } else if (unwrappedType instanceof z.ZodDate) {
      return 'INTEGER';
    } else if (unwrappedType instanceof z.ZodBigInt) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodEnum) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodNativeEnum) {
      return 'TEXT';
    } else if (unwrappedType instanceof z.ZodLiteral) {
      // Check literal value type
      const value = (unwrappedType as any)._def.value;
      if (typeof value === 'boolean') {
        return 'INTEGER';
      } else if (typeof value === 'number') {
        return Number.isInteger(value) ? 'INTEGER' : 'REAL';
      } else {
        return 'TEXT';
      }
    } else {
      // Default for objects, arrays, etc.
      return 'TEXT';
    }
  }

  /**
   * Recursively unwrap Zod types
   */
  private unwrapZodType(zodType: z.ZodTypeAny): z.ZodTypeAny {
    const def = (zodType as any)._def;
    
    // Handle ZodEffects (preprocess/transform/refine)
    if (zodType instanceof z.ZodEffects) {
      if (def.schema) {
        return this.unwrapZodType(def.schema);
      }
      if (def.innerType) {
        return this.unwrapZodType(def.innerType);
      }
    }
    
    // Handle other wrapper types
    if (zodType instanceof z.ZodOptional ||
        zodType instanceof z.ZodNullable ||
        zodType instanceof z.ZodDefault ||
        zodType instanceof z.ZodBranded ||
        zodType instanceof z.ZodReadonly ||
        zodType instanceof z.ZodCatch ||
        zodType instanceof z.ZodPromise) {
      
      if (def.innerType) {
        return this.unwrapZodType(def.innerType);
      }
      if (def.valueType) {
        return this.unwrapZodType(def.valueType);
      }
      if (def.type) {
        return this.unwrapZodType(def.type);
      }
    }
    
    // Handle ZodLazy
    if (zodType instanceof z.ZodLazy && def.getter) {
      try {
        return this.unwrapZodType(def.getter());
      } catch {
        return z.string();
      }
    }
    
    // Handle pipeline
    if ((zodType as any).constructor.name === 'ZodPipeline' && def.in) {
      return this.unwrapZodType(def.in);
    }
    
    // Handle unions
    if (zodType instanceof z.ZodUnion) {
      const options = def.options as z.ZodTypeAny[];
      const unwrappedTypes = options.map(opt => this.unwrapZodType(opt));
      
      // Try to find a boolean type in the union
      const booleanType = unwrappedTypes.find(t => t instanceof z.ZodBoolean);
      if (booleanType) return booleanType;
      
      // Try to find a number type
      const numberType = unwrappedTypes.find(t => t instanceof z.ZodNumber);
      if (numberType) return numberType;
      
      // Try to find a string type
      const stringType = unwrappedTypes.find(t => t instanceof z.ZodString);
      if (stringType) return stringType;
      
      // Return first type
      return unwrappedTypes[0] || z.string();
    }
    
    // Handle intersections
    if (zodType instanceof z.ZodIntersection) {
      const left = this.unwrapZodType(def.left);
      const right = this.unwrapZodType(def.right);
      
      // Prefer boolean > number > string > other
      if (left instanceof z.ZodBoolean || right instanceof z.ZodBoolean) {
        return z.boolean();
      }
      if (left instanceof z.ZodNumber || right instanceof z.ZodNumber) {
        return z.number();
      }
      if (left instanceof z.ZodString || right instanceof z.ZodString) {
        return z.string();
      }
      
      return left;
    }
    
    // Handle discriminated unions
    if (zodType instanceof z.ZodDiscriminatedUnion) {
      const allTypes: z.ZodTypeAny[] = [];
      for (const options of def.options.values()) {
        options.forEach((opt: z.ZodTypeAny) => 
          allTypes.push(this.unwrapZodType(opt))
        );
      }
      
      // Similar logic to regular union
      const booleanType = allTypes.find(t => t instanceof z.ZodBoolean);
      if (booleanType) return booleanType;
      
      const numberType = allTypes.find(t => t instanceof z.ZodNumber);
      if (numberType) return numberType;
      
      const stringType = allTypes.find(t => t instanceof z.ZodString);
      if (stringType) return stringType;
      
      return allTypes[0] || z.string();
    }
    
    // Return the type as-is
    return zodType;
  }

  /**
   * Check if a ZodNumber type represents an integer
   */
  private isIntegerType(zodNumber: z.ZodNumber): boolean {
    const checks = (zodNumber as any)._def.checks || [];
    return checks.some((check: any) => check.kind === 'int');
  }
  private createIndexes(tableName: string, options: TableOptions): void {
    // Create regular indexes
    for (const index of options.indexes || []) {
      const indexSQL = `CREATE INDEX IF NOT EXISTS "idx_${tableName}_${index}" ON "${tableName}" ("${index}")`;
      try {
        this.storage.sql.exec(indexSQL);
      }
      catch (e) {
        console.error(`Error in createIndexes, sql: ${indexSQL}`);
        throw e;
      }                        
    }

    // Create unique indexes
    for (const uniqueIndex of options.uniqueIndexes || []) {
      const uniqueIndexSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_${uniqueIndex}" ON "${tableName}" ("${uniqueIndex}")`;
      try {
        this.storage.sql.exec(uniqueIndexSQL);
      }
      catch (e) {
        console.error(`Error in createIndexes, sql: ${uniqueIndexSQL}`);
        throw e;
      }                  
    }

    // Create composite unique indexes for user/organization scoped tables
    if (options.userScoped && options.organizationScoped) {
      const compositeUniqueSQL = `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_${tableName}_user_org" ON "${tableName}" ("user_id", "organization_id")`;
      try {
        this.storage.sql.exec(compositeUniqueSQL);
      }
      catch (e) {
        console.error(`Error in createIndexes, sql: ${compositeUniqueSQL}`);
        throw e;
      }      
    }
  }

  async execTransaction(operations: Array<{ sql: string; params?: any[] }>): Promise<void> {
    if (!operations.length) {
      throw new Error('Empty transaction');
    }    
      await this.storage.transactionSync(async () => {
        for (const op of operations) {
          try {
            this.storage.sql.exec(op.sql, ...(op.params || []));              
          }
          catch (e) {
            console.error(`Error in execTransaction, sql: ${op.sql}, params: ${JSON.stringify((op.params || []))}`);
            throw e;
          }
        }        
      });
  }

  async execSelectSQL(sql: string, params: any[] = []): Promise<any[]> {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT statements are allowed in execSelectSQL');
    }      
    let cursor;
    try {
      cursor = this.storage.sql.exec(sql, ...params);
    }
    catch (e) {
      console.error(`Error in execSelectSQL, sql: ${sql}, params: ${JSON.stringify(params)}`);
      throw e;
    }
    const result = cursor.toArray();
    return result;
  }
}