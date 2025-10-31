import { Context } from 'hono';
import { getDO } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createServiceInfrastructureService } from './infrastructure';
import {
  RegisterService,
  VNPayPayment,
  ServiceUsage,
  IServiceApplicationService,
} from './domain';

export function createServiceApplicationService(c: Context, bindingName: string): IServiceApplicationService {
  return {
    async registerService(identifier: string, request: RegisterService): Promise<any> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
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
      const userDO = getDO<UserDO>(c, identifier, bindingName);
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
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      await serviceInfra.cancelService(serviceId);
    },

    async processVNPayPayment(identifier: string, request: VNPayPayment): Promise<{ success: boolean; transactionId: string }> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      return await serviceInfra.processVNPayPayment(request);
    },

    async recordEndpointUsage(identifier: string, usage: ServiceUsage): Promise<void> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      await serviceInfra.recordEndpointUsage(usage);
    },

    async getServiceUsage(identifier: string, serviceId: string, days?: number): Promise<ServiceUsage[]> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const serviceInfra = createServiceInfrastructureService(userDO);
      return await serviceInfra.getServiceUsage(serviceId, days);
    },
  };
}