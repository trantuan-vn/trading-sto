import { handleError } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { 
  IVNPayService, 
  IPaymentRepository, 
  ICryptoService,
  CreatePayment,
  PaymentQuery,
  RefundRequest,
  VNPayReturn,
  VNPayIPN,
  PaymentUrlResult,
  PaymentResult,
  QueryDRResult,
  RefundResult
} from './domain';
import { config } from './config';
import { sortObjectUtil, getResponseMessage } from './utils';
import moment from 'moment';
import crypto from 'crypto';

export function createVNPayService(userDO: UserDO): IVNPayService {
  const cryptoService = createCryptoService();
  const paymentRepo = createPaymentRepository(userDO);

  return {
    async createPaymentUrl(request: CreatePayment, ipAddr: string): Promise<PaymentUrlResult> {
      try {
        process.env.TZ = 'Asia/Ho_Chi_Minh';
        
        const date = new Date();
        const createDate = moment(date).format('YYYYMMDDHHmmss');
        
        const tmnCode = config.get('vnp_TmnCode');
        const secretKey = config.get('vnp_HashSecret');
        const vnpUrl = config.get('vnp_Url');
        const returnUrl = config.get('vnp_ReturnUrl');

        const orderId = moment(date).format('DDHHmmss');
        
        const vnp_Params: Record<string, any> = {
          'vnp_Version': '2.1.0',
          'vnp_Command': 'pay',
          'vnp_TmnCode': tmnCode,
          'vnp_Locale': request.language,
          'vnp_CurrCode': 'VND',
          'vnp_TxnRef': orderId,
          'vnp_OrderInfo': request.orderInfo || `Thanh toan cho ma GD:${orderId}`,
          'vnp_OrderType': request.orderType,
          'vnp_Amount': request.amount * 100,
          'vnp_ReturnUrl': returnUrl,
          'vnp_IpAddr': ipAddr,
          'vnp_CreateDate': createDate,
          'vnp_ExpireDate': moment(createDate).add(15, 'm').format('YYYYMMDDHHmmss')
        };

        if (request.bankCode) {
          vnp_Params['vnp_BankCode'] = request.bankCode;
        }

        const sortedParams = cryptoService.sortObject(vnp_Params);
        const querystring = require('qs');
        const signData = querystring.stringify(sortedParams, { encode: false });
        const signed = cryptoService.createSHA512Signature(signData, secretKey);
        
        vnp_Params['vnp_SecureHash'] = signed;
        const paymentUrl = vnpUrl + '?' + querystring.stringify(vnp_Params, { encode: false });

        return {
          paymentUrl,
          orderId,
          amount: request.amount
        };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to create payment URL');
        throw { errorResponse, status };
      }
    },

    async processReturn(params: VNPayReturn): Promise<PaymentResult> {
      try {
        const secretKey = config.get('vnp_HashSecret');
        const secureHash = params.vnp_SecureHash;

        const paramsWithoutHash = { ...params } as any;
        delete paramsWithoutHash.vnp_SecureHash;
        delete paramsWithoutHash.vnp_SecureHashType;

        const isValid = cryptoService.validateSignature(paramsWithoutHash, secretKey, secureHash);

        if (isValid) {
          return {
            success: params.vnp_ResponseCode === '00',
            code: params.vnp_ResponseCode,
            message: getResponseMessage(params.vnp_ResponseCode),
            orderId: params.vnp_TxnRef,
            amount: parseInt(params.vnp_Amount) / 100,
            transactionNo: params.vnp_TransactionNo,
            bankCode: params.vnp_BankCode
          };
        } else {
          return {
            success: false,
            code: '97',
            message: 'Invalid checksum'
          };
        }
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to process return');
        throw { errorResponse, status };
      }
    },

    async processIPN(params: VNPayIPN): Promise<PaymentResult> {
      try {
        const secretKey = config.get('vnp_HashSecret');
        const secureHash = params.vnp_SecureHash;

        const paramsWithoutHash = { ...params } as any;
        delete paramsWithoutHash.vnp_SecureHash;
        delete paramsWithoutHash.vnp_SecureHashType;

        const isValid = cryptoService.validateSignature(paramsWithoutHash, secretKey, secureHash);
        
        if (!isValid) {
          return {
            success: false,
            code: '97',
            message: 'Checksum failed'
          };
        }

        const orderInfo = await paymentRepo.findOrderById(params.vnp_TxnRef);
        
        if (!orderInfo.exists) {
          return {
            success: false,
            code: '01',
            message: 'Order not found'
          };
        }

        const amount = parseInt(params.vnp_Amount) / 100;
        if (orderInfo.amount !== amount) {
          return {
            success: false,
            code: '04',
            message: 'Amount invalid'
          };
        }

        if (orderInfo.status !== 'pending') {
          return {
            success: false,
            code: '02',
            message: 'This order has been updated to the payment status'
          };
        }

        if (params.vnp_ResponseCode === '00') {
          await paymentRepo.updatePaymentStatus(params.vnp_TxnRef, 'success', params);
          return {
            success: true,
            code: '00',
            message: 'Success'
          };
        } else {
          await paymentRepo.updatePaymentStatus(params.vnp_TxnRef, 'failed', params);
          return {
            success: false,
            code: params.vnp_ResponseCode,
            message: getResponseMessage(params.vnp_ResponseCode)
          };
        }
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to process IPN');
        throw { errorResponse, status };
      }
    },

    async queryTransaction(request: PaymentQuery, ipAddr: string): Promise<QueryDRResult> {
      try {
        process.env.TZ = 'Asia/Ho_Chi_Minh';
        const date = new Date();

        const vnp_TmnCode = config.get('vnp_TmnCode');
        const secretKey = config.get('vnp_HashSecret');
        const vnp_Api = config.get('vnp_Api');

        const vnp_RequestId = moment(date).format('HHmmss');
        const vnp_CreateDate = moment(date).format('YYYYMMDDHHmmss');

        const data = `${vnp_RequestId}|2.1.0|querydr|${vnp_TmnCode}|${request.orderId}|${request.transDate}|${vnp_CreateDate}|${ipAddr}|Truy van GD ma:${request.orderId}`;
        
        const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);

        const dataObj = {
          'vnp_RequestId': vnp_RequestId,
          'vnp_Version': '2.1.0',
          'vnp_Command': 'querydr',
          'vnp_TmnCode': vnp_TmnCode,
          'vnp_TxnRef': request.orderId,
          'vnp_OrderInfo': `Truy van GD ma:${request.orderId}`,
          'vnp_TransactionDate': request.transDate,
          'vnp_CreateDate': vnp_CreateDate,
          'vnp_IpAddr': ipAddr,
          'vnp_SecureHash': vnp_SecureHash
        };

        const response = await fetch(vnp_Api, {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dataObj)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const body = await response.json() as any;
        
        return {
          responseCode: body.responseCode || '00',
          message: body.message || 'Success',
          transaction: body
        };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to query transaction');
        throw { errorResponse, status };
      }
    },

    async refundTransaction(request: RefundRequest, ipAddr: string): Promise<RefundResult> {
      try {
        process.env.TZ = 'Asia/Ho_Chi_Minh';
        const date = new Date();

        const vnp_TmnCode = config.get('vnp_TmnCode');
        const secretKey = config.get('vnp_HashSecret');
        const vnp_Api = config.get('vnp_Api');

        const vnp_RequestId = moment(date).format('HHmmss');
        const vnp_CreateDate = moment(date).format('YYYYMMDDHHmmss');
        const vnp_TransactionNo = '0';

        const data = `${vnp_RequestId}|2.1.0|refund|${vnp_TmnCode}|${request.transType}|${request.orderId}|${request.amount * 100}|${vnp_TransactionNo}|${request.transDate}|${request.user}|${vnp_CreateDate}|${ipAddr}|Hoan tien GD ma:${request.orderId}`;
        
        const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);

        const dataObj = {
          'vnp_RequestId': vnp_RequestId,
          'vnp_Version': '2.1.0',
          'vnp_Command': 'refund',
          'vnp_TmnCode': vnp_TmnCode,
          'vnp_TransactionType': request.transType,
          'vnp_TxnRef': request.orderId,
          'vnp_Amount': request.amount * 100,
          'vnp_TransactionNo': vnp_TransactionNo,
          'vnp_CreateBy': request.user,
          'vnp_OrderInfo': `Hoan tien GD ma:${request.orderId}`,
          'vnp_TransactionDate': request.transDate,
          'vnp_CreateDate': vnp_CreateDate,
          'vnp_IpAddr': ipAddr,
          'vnp_SecureHash': vnp_SecureHash
        };

        const response = await fetch(vnp_Api, {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dataObj)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const body = await response.json() as any;
        
        return {
          responseCode: body.responseCode || '00',
          message: body.message || 'Success',
          refundId: body.refundId
        };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to process refund');
        throw { errorResponse, status };
      }
    }
  };
}

export function createCryptoService(): ICryptoService {
  return {
    createSHA512Signature(data: string, secretKey: string): string {
      const hmac = crypto.createHmac("sha512", secretKey);
      return hmac.update(Buffer.from(data, 'utf-8')).digest("hex");
    },

    validateSignature(params: Record<string, any>, secretKey: string, secureHash: string): boolean {
      const sortedParams = sortObjectUtil(params);
      const querystring = require('qs');
      const signData = querystring.stringify(sortedParams, { encode: false });
      const calculatedHash = this.createSHA512Signature(signData, secretKey);
      return secureHash === calculatedHash;
    },

    sortObject(obj: Record<string, any>): Record<string, any> {
      return sortObjectUtil(obj);
    }
  };
}

export function createPaymentRepository(userDO: UserDO): IPaymentRepository {
  return {
    async findOrderById(orderId: string): Promise<{ exists: boolean; amount?: number; status?: string }> {
      try {
        // Implementation to find order in database
        const order = await userDO.getStorage().get(`order_${orderId}`) as any;
        
        if (!order) {
          return { exists: false };
        }

        return {
          exists: true,
          amount: order.amount,
          status: order.status
        };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to find order');
        throw { errorResponse, status };
      }
    },

    async updatePaymentStatus(orderId: string, status: string, transactionData: any): Promise<void> {
      try {
        const order = await userDO.getStorage().get(`order_${orderId}`) || {} as any;
        order.status = status;
        order.transactionData = transactionData;
        order.updatedAt = new Date().toISOString();
        
        await userDO.getStorage().put(`order_${orderId}`, order);
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to update payment status');
        throw { errorResponse, status };
      }
    },

    async createRefundRecord(refundData: any): Promise<string> {
      try {
        const refundId = `refund_${Date.now()}`;
        refundData.id = refundId;
        refundData.createdAt = new Date().toISOString();
        
        await userDO.getStorage().put(`refund_${refundId}`, refundData);
        return refundId;
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to create refund record');
        throw { errorResponse, status };
      }
    }
  };
}

