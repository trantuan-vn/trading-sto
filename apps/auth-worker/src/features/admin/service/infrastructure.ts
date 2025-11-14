import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  RegisterService,
  IServiceInfrastructureService,
  ServiceSchema,
  ServiceUsageSchema
} from './domain';

export function createServiceInfrastructureService(userDO: UserDO): IServiceInfrastructureService {

  const services = userDO.table('services', ServiceSchema, { userScoped: true });
  const serviceUsages = userDO.table('service_usages', ServiceUsageSchema, { userScoped: true });

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
      };

      const createdRecord = await services.create(serviceData); // Giả định table `services` trong UserDO
      return { ...serviceData, id: createdRecord.id };
    },

    async getUserServices(): Promise<any[]> {
      return await services.getAll();
    },

    async cancelService(serviceId: string): Promise<void> {
      const record = await services.findById(serviceId);
      if (!record ) {
        throw new Error('Service not found');
      }
      await services.update(serviceId, { ...record, isActive: false });
    },

    async getServiceUsage(serviceId: string, days: number = 30): Promise<any[]> {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      return await serviceUsages
        .where('serviceId', '==', serviceId)
        .where('timestamp', '>=', cutoff)
        .get();
    },
  };
}