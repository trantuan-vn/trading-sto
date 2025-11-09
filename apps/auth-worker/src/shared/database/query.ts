import { z } from 'zod';

type Condition = {
  path: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'includes' | 'in';
  value: any;
};

type LogicalCondition = {
  type: 'and' | 'or';
  conditions: WhereCondition[];
};

type WhereCondition = Condition | LogicalCondition;

export class GenericQuery<T> {
  private conditions: WhereCondition[] = [];
  private orderByClause?: { field: string; direction: 'asc' | 'desc' };
  private limitCount?: number;
  private offsetCount?: number;

  constructor(
    private tableName: string,
    private storage: DurableObjectStorage,
    private schema: z.ZodSchema<T>,
    private userId: string,
    private getOrganizationContext: () => string | undefined
  ) { }

  private get organizationContext(): string | undefined {
    return this.getOrganizationContext();
  }

  where(path: string, operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'includes' | 'in', value: any): this {
    this.conditions.push({ path, operator, value });
    return this;
  }

  and(conditions: ((query: GenericQuery<T>) => void) | WhereCondition[]): this {
    if (typeof conditions === 'function') {
      const subQuery = new GenericQuery(
        this.tableName,
        this.storage,
        this.schema,
        this.userId,
        this.getOrganizationContext
      );
      conditions(subQuery);
      this.conditions.push({
        type: 'and',
        conditions: subQuery.conditions
      });
    } else {
      this.conditions.push({
        type: 'and',
        conditions
      });
    }
    return this;
  }

  or(conditions: ((query: GenericQuery<T>) => void) | WhereCondition[]): this {
    if (typeof conditions === 'function') {
      const subQuery = new GenericQuery(
        this.tableName,
        this.storage,
        this.schema,
        this.userId,
        this.getOrganizationContext
      );
      conditions(subQuery);
      this.conditions.push({
        type: 'or',
        conditions: subQuery.conditions
      });
    } else {
      this.conditions.push({
        type: 'or',
        conditions
      });
    }
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderByClause = { field, direction };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  private buildWhereClause(conditions: WhereCondition[], params: any[]): string {
    if (conditions.length === 0) return '';

    const processCondition = (condition: WhereCondition): string => {
      if ('type' in condition) {
        // Logical condition (AND/OR)
        const subClauses = condition.conditions
          .map(processCondition)
          .filter(clause => clause !== '');
        
        if (subClauses.length === 0) return '';
        if (subClauses.length === 1) return subClauses[0];
        
        const operator = condition.type.toUpperCase();
        return `(${subClauses.join(` ${operator} `)})`;
      } else {
        // Simple condition
        const jsonPath = `$.${condition.path}`;
        switch (condition.operator) {
          case '==':
            params.push(condition.value);
            return `json_extract(data, '${jsonPath}') = ?`;
          case '!=':
            params.push(condition.value);
            return `json_extract(data, '${jsonPath}') != ?`;
          case '>':
            params.push(condition.value);
            return `json_extract(data, '${jsonPath}') > ?`;
          case '<':
            params.push(condition.value);
            return `json_extract(data, '${jsonPath}') < ?`;
          case '>=':
            params.push(condition.value);
            return `json_extract(data, '${jsonPath}') >= ?`;
          case '<=':
            params.push(condition.value);
            return `json_extract(data, '${jsonPath}') <= ?`;
          case 'includes':
            params.push(`%${condition.value}%`);
            return `json_extract(data, '${jsonPath}') LIKE ?`;
          case 'in':
            if (!Array.isArray(condition.value)) {
              throw new Error('IN operator requires an array value');
            }
            if (condition.value.length === 0) {
              return '1=0';
            }
            const placeholders = condition.value.map(() => '?').join(', ');
            params.push(...condition.value);
            return `json_extract(data, '${jsonPath}') IN (${placeholders})`;
          default:
            throw new Error(`Unsupported operator: ${condition.operator}`);
        }
      }
    };

    const clauses = conditions
      .map(processCondition)
      .filter(clause => clause !== '');

    if (clauses.length === 0) return '';
    if (clauses.length === 1) return clauses[0];

    return clauses.join(' AND ');
  }

  async get(): Promise<Array<T & { id: string; createdAt: Date; updatedAt: Date }>> {
    let sql: string;
    let params: any[] = [];

    if (this.organizationContext) {
      sql = `SELECT * FROM "${this.tableName}" WHERE user_id = ? AND organization_id = ?`;
      params = [this.userId, this.organizationContext];
    } else {
      sql = `SELECT * FROM "${this.tableName}" WHERE user_id = ?`;
      params = [this.userId];
    }

    // Add WHERE conditions
    const whereClause = this.buildWhereClause(this.conditions, params);
    if (whereClause) {
      sql += ` AND (${whereClause})`;
    }

    // Add ORDER BY
    if (this.orderByClause) {
      const { field, direction } = this.orderByClause;
      if (field === 'createdAt' || field === 'updatedAt') {
        const dbField = field === 'createdAt' ? 'created_at' : 'updated_at';
        sql += ` ORDER BY ${dbField} ${direction.toUpperCase()}`;
      } else {
        const jsonPath = `$.${field}`;
        sql += ` ORDER BY json_extract(data, '${jsonPath}') ${direction.toUpperCase()}`;
      }
    }

    // Add LIMIT and OFFSET
    if (this.limitCount) {
      sql += ` LIMIT ${this.limitCount}`;
    }
    if (this.offsetCount) {
      sql += ` OFFSET ${this.offsetCount}`;
    }

    const cursor = this.storage.sql.exec(sql, ...params);
    const results: Array<T & { id: string; createdAt: Date; updatedAt: Date }> = [];

    for (const row of cursor) {
      const data = JSON.parse(row.data as string);
      results.push({
        ...data,
        id: row.id as string,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      });
    }

    return results;
  }

  async first(): Promise<(T & { id: string; createdAt: Date; updatedAt: Date }) | null> {
    const results = await this.limit(1).get();
    return results[0] || null;
  }

  async count(): Promise<number> {
    let sql: string;
    let params: any[] = [];

    if (this.organizationContext) {
      sql = `SELECT COUNT(*) as count FROM "${this.tableName}" WHERE user_id = ? AND organization_id = ?`;
      params = [this.userId, this.organizationContext];
    } else {
      sql = `SELECT COUNT(*) as count FROM "${this.tableName}" WHERE user_id = ?`;
      params = [this.userId];
    }

    const whereClause = this.buildWhereClause(this.conditions, params);
    if (whereClause) {
      sql += ` AND (${whereClause})`;
    }

    const cursor = this.storage.sql.exec(sql, ...params);
    const results = cursor.toArray();
    return results.length > 0 ? Number(results[0].count) : 0;
  }
}

// 1. Toán tử IN
// // Tìm các bản ghi có status là 'active' hoặc 'pending'
// query.where('status', 'in', ['active', 'pending']);
// // Tìm các bản ghi có category trong danh sách nhất định
// query.where('category', 'in', ['tech', 'science', 'business']);

// 2. Điều kiện AND
// Sử dụng mảng điều kiện
// query.and([
//   { path: 'status', operator: '==', value: 'active' },
//   { path: 'priority', operator: '>', value: 5 }
// ]);
// // Sử dụng callback function (fluent interface)
// query.and((q) => {
//   q.where('status', '==', 'active')
//    .where('priority', '>', 5);
// });

// 3. Điều kiện OR
// Sử dụng mảng điều kiện
// query.or([
//   { path: 'status', operator: '==', value: 'active' },
//   { path: 'priority', operator: '>', value: 8 }
// ]);
// // Sử dụng callback function
// query.or((q) => {
//   q.where('status', '==', 'active')
//    .where('priority', '>', 8);
// });

// 4. Kết hợp các điều kiện phức tạp
// // (status = 'active' OR priority > 8) AND category = 'tech'
// query
//   .and((q) => {
//     q.where('status', '==', 'active')
//      .or((subQ) => {
//        subQ.where('priority', '>', 8);
//      });
//   })
//   .where('category', '==', 'tech');

// // SQL sẽ tạo ra:
// // WHERE user_id = ? AND ((json_extract(data, '$.status') = ? OR json_extract(data, '$.priority') > ?) AND json_extract(data, '$.category') = ?)