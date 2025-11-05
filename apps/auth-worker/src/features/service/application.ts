import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createServiceInfrastructureService } from './infrastructure';
import {
  RegisterService,
  ServiceUsage,
} from './domain';

export interface IServiceApplicationService {
  registerService(identifier: string, request: RegisterService): Promise<Service>;
  getUserServices(identifier: string): Promise<Service[]>;
  cancelService(identifier: string, serviceId: string): Promise<void>;
  getServiceUsage(identifier: string, serviceId: string, days?: number): Promise<ServiceUsage[]>;
}

export function createServiceApplicationService(c: Context, bindingName: string): IServiceApplicationService {
  return {
    async registerService(identifier: string, request: RegisterService): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      const service = await serviceInfra.registerService(request);
      return {
        id: service.id,
        name: service.name,
        endpoints: service.endpoints,
        maxCalls: service.maxCalls,
        currentCalls: service.currentCalls,
        expiresAt: service.expiresAt,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        isActive: service.isActive,
      };
    },

    async getUserServices(identifier: string): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      const services = await serviceInfra.getUserServices();
      return services.map(service => ({
        id: service.id,
        name: service.name,
        endpoints: service.endpoints,
        maxCalls: service.maxCalls,
        currentCalls: service.currentCalls,
        expiresAt: service.expiresAt,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        isActive: service.isActive,
      }));
    },

    async cancelService(identifier: string, serviceId: string): Promise<void> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      await serviceInfra.cancelService(serviceId);
    },

    async getServiceUsage(identifier: string, serviceId: string, days?: number): Promise<ServiceUsage[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      return await serviceInfra.getServiceUsage(serviceId, days);
    },
  };
}