import { handleError } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { 
  IVNPayService, 
  ICryptoService,
  CreatePayment,
  PaymentQuery,
  RefundRequest,
  QueryDRResult,
  RefundResult,
  OrderSchema,
  PaymentSchema,
  RefundSchema,
  VNPayReturn,
  PaymentResult
} from './domain';

import { ServiceSchema } from '../service/domain';

import { config } from './config';
import { sortObjectUtil, getResponseMessage } from './utils';
import moment from 'moment';
import crypto from 'crypto';

export function createVNPayService(userDO: UserDO): IVNPayService {
  const cryptoService = createCryptoService();
  
  const orders = userDO.table('orders', OrderSchema, { userScoped: true });
  const payments = userDO.table('payments', PaymentSchema, { userScoped: true });
  const refunds = userDO.table('refunds', RefundSchema, { userScoped: true });
  const services = userDO.table('services', ServiceSchema, { userScoped: true });

  return {
    async createPaymentUrl(request: CreatePayment, ipAddr: string, identifier: string): Promise<string> {
      for (const item of request.orderInfo.items) {
        const service = await services.findById(item.serviceId);
        if (!service || service.isActive===false) {
          throw new Error(`Service ${item.serviceId} not found or inactive`);
        }
      }

      const order= await orders.create(request.orderInfo);
      const paymentData = PaymentSchema.parse({
        orderId: order.id,
        paymentMethod: request.bankCode === 'INTCARD' ? 'credit_card': 'bank_transfer',
        gateway: 'vnpay',
      });
      const payment = await payments.create(paymentData);
      

      const date = new Date();
      const createDate = moment(date).format('YYYYMMDDHHmmss');
      
      const tmnCode = config.get('vnp_TmnCode');
      const secretKey = config.get('vnp_HashSecret');
      const vnpUrl = config.get('vnp_Url');
      const returnUrl = config.get('vnp_ReturnUrl');
      
      const vnp_Params: Record<string, any> = {
        'vnp_Version': '2.1.0',
        'vnp_Command': 'pay',
        'vnp_TmnCode': tmnCode,
        'vnp_Locale': request.language,
        'vnp_CurrCode': 'VND',
        'vnp_TxnRef': `${identifier}&${payment.id}`,
        'vnp_OrderInfo': request.orderInfo || `Thanh toan cho ma GD:${identifier}&${payment.id}`,
        'vnp_OrderType': 'billpayment',
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

      return paymentUrl;
    },

    async processReturn(paymentId: string, params: VNPayReturn): Promise<PaymentResult>{

      const payment = await payments.findById(paymentId);
      if (payment && payment.status === 'pending') {
        const order = await orders.findById(payment.orderId);
        if (!order) {
          throw new Error('Order not found');
        }
        if (order.amount !== parseInt(params.vnp_Amount) / 100) {
          throw new Error('Invalid amount');
        }
        await userDO.getStorage().transactionSync(() => {
          payments.updateSync(payment.id, { status: params.vnp_ResponseCode === '00'? 'completed': 'failed', paymentDetails: params });
          if (order.status === 'pending') {
            const updateOrder = orders.updateSync(payment.orderId, { status: params.vnp_ResponseCode === '00'? 'paid': 'failed' });
            for (const item of updateOrder.items) {
              const service = services.findByIdSync(item.serviceId);
              if (!service || service.isActive===false) {
                throw new Error(`Service ${item.serviceId} not found or inactive`);
              }
              services.updateSync(item.serviceId, {...service, maxCalls: service.maxCalls + item.quantity});
            }
          }
        });
      }
      else {
        throw new Error('Payment not found or already processed');
      }

      return {
        success: params.vnp_ResponseCode === '00',
        code: params.vnp_ResponseCode,
        message: getResponseMessage(params.vnp_ResponseCode),  
        orderId: payment!.orderId,
        amount: parseInt(params.vnp_Amount) / 100,
        transactionNo: params.vnp_TransactionNo,
        bankCode: params.vnp_BankCode
      };        
    },

    async processIPN(paymentId: string, params: VNPayReturn): Promise<PaymentResult> {
      const payment = await payments.findById(paymentId);
      if (payment) {
        if (payment.status !== 'pending') {
          return {
            success: false,
            code: '02',
            message: 'This order has been updated to the payment status',  
          };
        }

        const order = await orders.findById(payment.orderId);
        if (!order) {
          return {
            success: false,
            code: '01',
            message: 'Order not found',  
          };        
        }
        if (order.amount !== parseInt(params.vnp_Amount) / 100) {
          return {
            success: false,
            code: '04',
            message: 'Amount invalid',  
          };        
        }

        if (order.status === 'pending') {
          await userDO.getStorage().transactionSync(() => {
            payments.updateSync(payment.id, { status: params.vnp_ResponseCode === '00'? 'completed': 'failed', paymentDetails: params });
            if (order.status === 'pending') {
              const updateOrder = orders.updateSync(payment.orderId, { status: params.vnp_ResponseCode === '00'? 'paid': 'failed' });
              for (const item of updateOrder.items) {
                const service = services.findByIdSync(item.serviceId);
                if (!service || service.isActive===false) {
                  throw new Error(`Service ${item.serviceId} not found or inactive`);
                }
                services.updateSync(item.serviceId, {...service, maxCalls: service.maxCalls + item.quantity});
              }
            }
          });          
        }
        else {
          return {
            success: false,
            code: '02',
            message: 'This order has been updated to the payment status',  
          };
        }
      }
      else {
        return {
          success: false,
          code: '01',
          message: 'Order not found',  
        };        
      }

      return {
        success: params.vnp_ResponseCode === '00',
        code: params.vnp_ResponseCode,
        message: getResponseMessage(params.vnp_ResponseCode),  
      };        
    },

    async queryTransaction(identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult> {
      const payment = await payments.findById(request.paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      const date = new Date();

      const vnp_TmnCode = config.get('vnp_TmnCode');
      const secretKey = config.get('vnp_HashSecret');
      const vnp_Api = config.get('vnp_Api');

      const vnp_RequestId = moment(date).format('HHmmss');
      const vnp_CreateDate = moment(date).format('YYYYMMDDHHmmss');

      const data = `${vnp_RequestId}|2.1.0|querydr|${vnp_TmnCode}|${identifier}&${payment.id}|${request.transDate}|${vnp_CreateDate}|${ipAddr}|Truy van GD ma:${identifier}&${payment.id}`;
      
      const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);
      
      const dataObj = {
        'vnp_RequestId': vnp_RequestId,
        'vnp_Version': '2.1.0',
        'vnp_Command': 'querydr',
        'vnp_TmnCode': vnp_TmnCode,
        'vnp_TxnRef': `${identifier}&${payment.id}`,
        'vnp_OrderInfo': `Truy van GD ma: ${identifier}&${payment.id}`,
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
    },

    async refundTransaction(identifier: string, request: RefundRequest, ipAddr: string): Promise<RefundResult> {
      const date = new Date();

      const vnp_TmnCode = config.get('vnp_TmnCode');
      const secretKey = config.get('vnp_HashSecret');
      const vnp_Api = config.get('vnp_Api');

      const vnp_RequestId = moment(date).format('HHmmss');
      const vnp_CreateDate = moment(date).format('YYYYMMDDHHmmss');
      const payment= await payments.findById(request.paymentId);
      if (!payment || payment.status !== 'completed') {
        throw new Error('Payment not found or not completed');
      }

      const vnp_TransactionNo = payment.paymentDetails!.vnp_TransactionNo;

      const order= await orders.findById(payment.orderId);
      if (!order || order.status !== 'paid') {
        throw new Error('Order not found or not paid');
      }

      const data = `${vnp_RequestId}|2.1.0|refund|${vnp_TmnCode}|${request.transactionType}|${identifier}&${payment.id}|${order.amount}|${order.amount * 100}|${vnp_TransactionNo}|${vnp_CreateDate}|${identifier}|${vnp_CreateDate}|${ipAddr}|Hoan tien GD ma:${identifier}&${payment.id} voi ly do:${request.reason}`;
      
      const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);

      const dataObj = {
        'vnp_RequestId': vnp_RequestId,
        'vnp_Version': '2.1.0',
        'vnp_Command': 'refund',
        'vnp_TmnCode': vnp_TmnCode,
        'vnp_TransactionType': request.transactionType,
        'vnp_TxnRef': `${identifier}&${payment.id}`,
        'vnp_Amount': order.amount * 100,
        'vnp_TransactionNo': vnp_TransactionNo,
        'vnp_CreateBy': identifier,
        'vnp_OrderInfo': `Hoan tien GD ma:${identifier}&${payment.id} voi ly do:${request.reason}`,
        'vnp_TransactionDate': vnp_CreateDate,
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
      const refundData= RefundSchema.parse({
        ...request,
        refundDetails: body
      });
      const refund= refunds.createSync(refundData);      

      await userDO.getStorage().transactionSync(() => {        
        payments.updateSync(payment.id, { status: 'cancelled'});
        if (order.status === 'paid') {
          const updateOrder = orders.updateSync(payment.orderId, { status: 'cancelled' });
          for (const item of updateOrder.items) {
            const service = services.findByIdSync(item.serviceId);
            if (!service || service.isActive===false) {
              throw new Error(`Service ${item.serviceId} not found or inactive`);
            }
            services.updateSync(item.serviceId, {...service, maxCalls: service.maxCalls - item.quantity});
          }
          refunds.updateSync(refund.id, { status: body.responseCode === '00'? 'completed': 'failed' });
        }
      });          

      return {
        responseCode: body.responseCode || '00',
        message: body.message || 'Success',
        refundId: refund.id
      };
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
