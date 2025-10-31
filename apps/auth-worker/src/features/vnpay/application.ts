import { Context } from 'hono';
import { getDO } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createVNPayService } from './infrastructure';
import { 
  CreatePaymentSchema,
  PaymentQuerySchema,
  RefundSchema,
  VNPayReturnSchema,
  VNPayIPNSchema,
  CreatePayment,
  PaymentQuery,
  RefundRequest,
  PaymentUrlResult,
  PaymentResult,
  QueryDRResult,
  RefundResult
} from './domain';

interface IPaymentApplicationService {
  createPaymentUrlUseCase(identifier: string, request: CreatePayment, ipAddr: string): Promise<PaymentUrlResult>;
  processReturnUseCase(identifier: string, params: any): Promise<PaymentResult>;
  processIPNUseCase(identifier: string, params: any): Promise<PaymentResult>;
  queryTransactionUseCase(identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult>;
  refundTransactionUseCase(identifier: string, request: RefundRequest, ipAddr: string): Promise<RefundResult>;
}

export function createPaymentApplicationService(c: Context, bindingName: string): IPaymentApplicationService {
  return {
    async createPaymentUrlUseCase(identifier: string, request: CreatePayment, ipAddr: string): Promise<PaymentUrlResult> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const vnpayService = createVNPayService(userDO.getStorage(), userDO.getEnv());
      
      const validatedRequest = CreatePaymentSchema.parse(request);
      return await vnpayService.createPaymentUrl(validatedRequest, ipAddr);
    },

    async processReturnUseCase(identifier: string, params: any): Promise<PaymentResult> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const vnpayService = createVNPayService(userDO.getStorage(), userDO.getEnv());
      
      const validatedParams = VNPayReturnSchema.parse(params);
      return await vnpayService.processReturn(validatedParams);
    },

    async processIPNUseCase(identifier: string, params: any): Promise<PaymentResult> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const vnpayService = createVNPayService(userDO.getStorage(), userDO.getEnv());
      
      const validatedParams = VNPayIPNSchema.parse(params);
      return await vnpayService.processIPN(validatedParams);
    },

    async queryTransactionUseCase(identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const vnpayService = createVNPayService(userDO.getStorage(), userDO.getEnv());
      
      const validatedRequest = PaymentQuerySchema.parse(request);
      return await vnpayService.queryTransaction(validatedRequest, ipAddr);
    },

    async refundTransactionUseCase(identifier: string, request: RefundRequest, ipAddr: string): Promise<RefundResult> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const vnpayService = createVNPayService(userDO.getStorage(), userDO.getEnv());
      
      const validatedRequest = RefundSchema.parse(request);
      return await vnpayService.refundTransaction(validatedRequest, ipAddr);
    }
  };
}