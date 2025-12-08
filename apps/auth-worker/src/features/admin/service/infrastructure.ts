import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  Service,
  IServiceInfrastructureService,
} from './domain';
import { executeUtils } from '../../../shared/utils';
export function createServiceInfrastructureService(userDO: DurableObjectStub<UserDO>): IServiceInfrastructureService {

  return {
    async registerService(request: Service): Promise<any> {
      console.log(`Registering service: ${JSON.stringify(request)}`);
      return await executeUtils.executeDynamicAction(userDO, 'upsert', request, 'services');
    },

    async getUserServices(): Promise<any[]> {
      return await executeUtils.executeRepositorySelect(userDO, 'select * from services where isActive = 1 order by createdAt desc');
    },

    async cancelService(serviceId: string): Promise<void> {
      await executeUtils.executeDynamicAction(userDO, 'update', { id: serviceId, isActive: false }, 'services');
    },

    async getServiceUsage(serviceId: string, days: number = 30): Promise<any[]> {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      
      return await executeUtils.executeRepositorySelect(userDO,
        'select * from service_usages where serviceId = ? and createdAt >= ? order by createdAt desc',
        [serviceId, cutoff]
      );
    },
  };
}