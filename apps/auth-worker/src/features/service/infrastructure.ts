import { UserDO } from '../ws/infrastructure/UserDO';
import { handleError } from '../../shared/utils';
import {
  Service,
  RegisterService,
  VNPayPayment,
  ServiceUsage,
  IServiceInfrastructureService,
  ServiceSchema,
  ServiceUsageSchema
} from './domain';

import { config } from '../vnpay/config';

export function createServiceInfrastructureService(userDO: UserDO): IServiceInfrastructureService {
  const VNPAY_API_URL = config.get('vnp_Url');
  const VNPAY_SECRET = config.get('vnp_HashSecret');

  const services = userDO.table('services', ServiceSchema, { userScoped: true });
  const serviceUsages = userDO.table('service_usages', ServiceUsageSchema, { userScoped: true });

  return {
    async registerService(request: RegisterService): Promise<Service> {
      try {
        const serviceData = {
          id: crypto.randomUUID(),
          name: request.name,
          endpoints: request.endpoints,
          maxCalls: request.maxCalls,
          currentCalls: 0,
          expiresAt: request.expiresInDays
            ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true,
        };

        const createdRecord = await services.create(serviceData); // Giả định table `services` trong UserDO
        return { ...serviceData, id: createdRecord.id };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to register service');
        throw { errorResponse, status };
      }
    },

    async getUserServices(): Promise<Service[]> {
      try {
        return await services.getAll();
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to get user services');
        throw { errorResponse, status };
      }
    },

    async cancelService(serviceId: string): Promise<void> {
      try {
        const record = await services.findById(serviceId);
        if (!record ) {
          throw new Error('Service not found');
        }
        await services.update(serviceId, { ...record, isActive: false, updatedAt: new Date().toISOString() });
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to cancel service');
        throw { errorResponse, status };
      }
    },

    async processVNPayPayment(request: VNPayPayment): Promise<{ success: boolean; transactionId: string }> {
      try {
        const service = await services.findById(request.serviceId);
        if (!service  || !service.isActive) {
          throw new Error('Invalid or inactive service');
        }

        // Tạo request thanh toán VNPay (giả lập)
        const paymentData = {
          vnp_Amount: request.amount * 100, // VNPay yêu cầu nhân 100
          vnp_OrderInfo: request.orderInfo || `Thanh toan dich vu ${request.serviceId}`,
          vnp_TxnRef: crypto.randomUUID(),
          vnp_CreateDate: new Date().toISOString().replace(/[-:T.]/g, ''),
          vnp_IpAddr: request.ipAddress || '127.0.0.1',
        };
        // Gửi yêu cầu thanh toán tới VNPay (giả lập gọi API)
        const response = await fetch(VNPAY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...paymentData,
            vnp_SecureHash: createVNPaySecureHash(paymentData, VNPAY_SECRET), 
          }),
        });

        const result = await response.json() as any;
        if (!result.success) {
          throw new Error('VNPay payment failed');
        }

        // Tăng maxCalls dựa trên amount (giả định: 10,000 VND = 100 calls)
        const additionalCalls = Math.floor(request.amount / 100); // 1 VND = 0.01 call
        const updatedMaxCalls = service.maxCalls + additionalCalls;

        await services.update(request.serviceId, {
          ...service,
          maxCalls: updatedMaxCalls,
          updatedAt: new Date().toISOString(),
        });

        return { success: true, transactionId: paymentData.vnp_TxnRef };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to process VNPay payment');
        throw { errorResponse, status };
      }
    },

    async recordEndpointUsage(usage: ServiceUsage): Promise<void> {
      try {
        const service = await services.findById(usage.serviceId);
        if (!service || !service.isActive) {
          throw new Error('Invalid or inactive service');
        }
        if (!service.endpoints.includes(usage.endpoint)) {
          throw new Error('Endpoint not allowed for this service');
        }
        if (service.currentCalls >= service.maxCalls) {
          throw new Error('Service quota exceeded');
        }

        await serviceUsages.create(usage);
        await services.update(usage.serviceId, {
          ...service,
          currentCalls: service.currentCalls + 1,
          updatedAt: new Date().toISOString(),
        });

        // Trim nếu vượt quá 1000 records
        const count = await serviceUsages.where('serviceId', '==', usage.serviceId).count();
        if (count > 1000) {
          const excess = count - 1000;
          const oldest = await serviceUsages
            .where('serviceId', '==', usage.serviceId)
            .orderBy('timestamp', 'asc')
            .limit(excess)
            .get();
          for (const old of oldest) {
            await serviceUsages.delete(old.id);
          }
        }
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to record endpoint usage');
        throw { errorResponse, status };
      }
    },

    async getServiceUsage(serviceId: string, days: number = 30): Promise<ServiceUsage[]> {
      try {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        return await serviceUsages
          .where('serviceId', '==', serviceId)
          .where('timestamp', '>=', cutoff)
          .get();
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to get service usage');
        throw { errorResponse, status };
      }
    },
  };
}

// Hàm giả lập tạo secure hash cho VNPay
function createVNPaySecureHash(data: any, secret: string): string {
  const sortedKeys = Object.keys(data).sort();
  const dataString = sortedKeys.map(key => `${key}=${data[key]}`).join('&');
  return CryptoJS.HmacSHA512(dataString, secret).toString();
}