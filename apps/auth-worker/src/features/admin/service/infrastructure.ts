import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  RegisterService,
  IServiceInfrastructureService,
  ServiceSchema,
  ServiceUsageSchema
} from './domain';

export function createServiceInfrastructureService(userDO: DurableObjectStub<UserDO>): IServiceInfrastructureService {
  
  const executeRepositoryAction = async (operation: string, data: any, table: string): Promise<any> => {
    const response = await userDO.fetch('http://user.internal/repository/action', {
      method: 'POST',
      body: JSON.stringify({ table, operation, data })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to ${operation} ${table}: ${errorText}`);
    }
    
    return await response.json();
  };

  const executeRepositorySelect = async (sql: string, params: any[] = []): Promise<any[]> => {
    const response = await userDO.fetch('http://user.internal/repository/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }
    
    return await response.json();
  };

  return {
    async registerService(request: RegisterService): Promise<any> {
      const serviceData = {
        name: request.name,
        endpoint: request.endpoint,
        maxCalls: request.maxCalls,
        currentCalls: 0,
        expiresAt: request.expiresInDays
          ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return await executeRepositoryAction('create', serviceData, 'services');
    },

    async getUserServices(): Promise<any[]> {
      return await executeRepositorySelect(
        'select * from services order by createdAt desc'
      );
    },

    async cancelService(serviceId: string): Promise<void> {
      const record = await executeRepositoryAction('findById', { id: serviceId }, 'services');
      if (!record) {
        throw new Error('Service not found');
      }
      
      await executeRepositoryAction('update', { 
        id: serviceId, 
        data: { 
          ...record, 
          isActive: false,
          updatedAt: new Date().toISOString()
        } 
      }, 'services');
    },

    async getServiceUsage(serviceId: string, days: number = 30): Promise<any[]> {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      
      return await executeRepositorySelect(
        'select * from service_usages where serviceId = ? and timestamp >= ? order by timestamp desc',
        [serviceId, cutoff]
      );
    },
  };
}