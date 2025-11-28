import { Context } from 'hono';
import { getIdFromName } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createVNPayService, createCryptoService } from './infrastructure';
import { paymentUtils, cryptoUtils } from './utils';

import { 
  CreatePaymentSchema,
  PaymentQuerySchema,
  RefundSchema,
  VNPayReturnSchema,
  VNPayIPNSchema,
  CreatePayment,
  PaymentQuery,
  RefundRequest,
  PaymentResult,
  QueryDRResult,
  RefundResult
} from './domain';
import { config } from './config';
import { PAYMENT_ERROR_MESSAGES } from './constant';

interface IPaymentApplicationService {
  createPaymentUrlUseCase(identifier: string, request: CreatePayment, ipAddr: string): Promise<string>;
  processReturnUseCase(params: any): Promise<PaymentResult>;
  processIPNUseCase(params: any): Promise<PaymentResult>;
  queryTransactionUseCase(identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult>;
  refundTransactionUseCase(identifier: string, request: RefundRequest, ipAddr: string): Promise<RefundResult>;
}

export function createPaymentApplicationService(c: Context, bindingName: string): IPaymentApplicationService {
  const cryptoService = createCryptoService();

  const validateAndParseParams = (params: any) => {
    const secretKey = config.get('vnp_HashSecret');
    const secureHash = params.vnp_SecureHash;

    const paramsWithoutHash = { ...params } as any;
    delete paramsWithoutHash.vnp_SecureHash;
    delete paramsWithoutHash.vnp_SecureHashType;

    const isValid = cryptoService.validateSignature(paramsWithoutHash, secretKey, secureHash);      
    if (!isValid) {
      throw new Error(PAYMENT_ERROR_MESSAGES.CHECKSUM_FAILED);
    }

    const { identifier, paymentId } = paymentUtils.parsePaymentReference(params.vnp_TxnRef);
    return { identifier, paymentId, validatedParams: VNPayReturnSchema.parse(params) };
  };

  return {
    async createPaymentUrlUseCase(identifier: string, request: CreatePayment, ipAddr: string): Promise<string> {
      const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
      const vnpayService = createVNPayService(userDO);
      
      const validatedRequest = CreatePaymentSchema.parse(request);
      return await vnpayService.createPaymentUrl(validatedRequest, ipAddr, identifier);
    },

    async processReturnUseCase(params: any): Promise<PaymentResult> {
      const { identifier, paymentId, validatedParams } = validateAndParseParams(params);

      const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
      const vnpayService = createVNPayService(userDO);
      
      return await vnpayService.processReturn(paymentId, validatedParams);
    },

    async processIPNUseCase(params: any): Promise<PaymentResult> {
      try {
        const { identifier, paymentId, validatedParams } = validateAndParseParams(params);

        const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
        const vnpayService = createVNPayService(userDO);
        
        return await vnpayService.processIPN(paymentId, validatedParams);
      } catch (error) {
        return {
          success: false,
          code: '97',
          message: PAYMENT_ERROR_MESSAGES.CHECKSUM_FAILED,  
        };
      }
    },

    async queryTransactionUseCase(identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult> {
      const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
      const vnpayService = createVNPayService(userDO);
      
      const validatedRequest = PaymentQuerySchema.parse(request);
      return await vnpayService.queryTransaction(identifier, validatedRequest, ipAddr);
    },

    async refundTransactionUseCase(identifier: string, request: RefundRequest, ipAddr: string): Promise<RefundResult> {
      const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
      const vnpayService = createVNPayService(userDO);
      
      const validatedRequest = RefundSchema.parse(request);
      return await vnpayService.refundTransaction(identifier, validatedRequest, ipAddr);
    }
  };
}