import { UserDO } from '../../ws/infrastructure/UserDO';
import { 
  IVNPayService, 
  ICryptoService,
  CreatePayment,
  PaymentQuery,
  CreateRefund,
  QueryDRResult,
  RefundResult,
  PaymentSchema,
  RefundSchema,
  VNPayReturn,
  PaymentResult
} from './domain';

import { config } from './config';
import { paymentUtils, cryptoUtils } from './utils';
import { VNPAY_CONSTANTS, PAYMENT_STATUS, ORDER_STATUS, PAYMENT_ERROR_MESSAGES } from './constant';
import moment from 'moment';

import { executeUtils } from '../../../shared/utils';
export function createVNPayService(userDO: DurableObjectStub<UserDO>): IVNPayService {
  
  // Helper methods
  const updateServiceCalls = async (orderId: string, operation: 'add' | 'subtract'): Promise<void> => {
    const orderItems = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM order_items WHERE order_id = ?',
      [orderId]
    );

    for (const item of orderItems) {
      const services = await executeUtils.executeRepositorySelect(userDO,
        'SELECT * FROM services WHERE id = ? AND isActive = ?',
        [item.serviceId, 1]
      );
      
      if (services.length === 0) {
        throw new Error(PAYMENT_ERROR_MESSAGES.SERVICE_NOT_FOUND.replace('${item.serviceId}', item.serviceId));
      }

      const service = services[0];
      const newMaxCalls = operation === 'add' 
        ? service.maxCalls + item.quantity
        : service.maxCalls - item.quantity;
        
      await executeUtils.executeDynamicAction(userDO, 'update', { 
        id: service.id, 
        data: { maxCalls: newMaxCalls } 
      }, 'services');
    }
  };

  const validatePayment = async (paymentId: string, orderId: string, expectedAmount: number): Promise<void> => {
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ? AND status = ?',
      [paymentId, PAYMENT_STATUS.PENDING]
    );

    if (payments.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED);
    }

    const orders = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM orders WHERE id = ?',
      [orderId]
    );

    if (orders.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const order = orders[0];
    if (order.finalAmount !== expectedAmount) {
      throw new Error(PAYMENT_ERROR_MESSAGES.INVALID_AMOUNT);
    }
  };

  const processPaymentTransaction = async (
    paymentId: string, 
    orderId: string, 
    params: VNPayReturn, 
    isIPN: boolean = false
  ): Promise<void> => {
    const newPaymentStatus = params.vnp_ResponseCode === '00' 
      ? PAYMENT_STATUS.COMPLETED 
      : PAYMENT_STATUS.FAILED;

    // Update payment status
    await executeUtils.executeDynamicAction(userDO, 'update', { 
      id: paymentId, 
      data: { 
        status: newPaymentStatus, 
        paymentDetails: params 
      } 
    }, 'payments');

    // If payment successful and order is pending, complete the order
    if (params.vnp_ResponseCode === '00') {
      const orders = await executeUtils.executeRepositorySelect(userDO,
        'SELECT * FROM orders WHERE id = ? AND status = ?',
        [orderId, ORDER_STATUS.PENDING]
      );

      if (orders.length > 0) {
        await executeUtils.executeDynamicAction(userDO, 'update', { 
          id: orderId, 
          data: { status: ORDER_STATUS.COMPLETED } 
        }, 'orders');

        await updateServiceCalls(orderId, 'add');
      } else if (!isIPN) {
        throw new Error(PAYMENT_ERROR_MESSAGES.ORDER_NOT_FOUND);
      }
    }
  };

  const processRefundTransaction = async (
    identifier: string,
    paymentId: string,
    request: CreateRefund,
    refundResult: any
  ): Promise<string> => {
    const refundData = RefundSchema.parse({
      ...request,
      refundDetails: refundResult
    });
    
    const refund = await executeUtils.executeDynamicAction(userDO, 'insert', refundData, 'refunds');

    // Update payment and order status
    await executeUtils.executeDynamicAction(userDO, 'update', { 
      id: paymentId, 
      data: { status: PAYMENT_STATUS.CANCELLED } 
    }, 'payments');

    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ?',
      [paymentId]
    );

    if (payments.length > 0) {
      const payment = payments[0];
      await executeUtils.executeDynamicAction(userDO, 'update', { 
        id: payment.orderId, 
        data: { status: ORDER_STATUS.CANCELLED } 
      }, 'orders');

      await updateServiceCalls(payment.orderId, 'subtract');
      
      await executeUtils.executeDynamicAction(userDO, 'update', { 
        id: refund.id, 
        data: { 
          status: refundResult.responseCode === '00' 
            ? PAYMENT_STATUS.COMPLETED 
            : PAYMENT_STATUS.FAILED 
        } 
      }, 'refunds');
    }

    return refund.id;
  };

  const createPaymentUrl = async (request: CreatePayment, ipAddr: string, identifier: string): Promise<string> => {
    paymentUtils.validateAmount(request.amount);

    const paymentData = PaymentSchema.parse({
      orderId: request.orderId,
      paymentMethod: request.bankCode === 'INTCARD' ? 'credit_card' : 'bank_transfer',
      gateway: 'vnpay',
      status: PAYMENT_STATUS.PENDING
    });
    
    const payment = await executeUtils.executeDynamicAction(userDO, 'insert', paymentData, 'payments');
    
    const date = new Date();
    const createDate = moment(date).format('YYYYMMDDHHmmss');
    
    const tmnCode = config.get('vnp_TmnCode');
    const secretKey = config.get('vnp_HashSecret');
    const vnpUrl = config.get('vnp_Url');
    const returnUrl = config.get('vnp_ReturnUrl');
    
    const vnp_Params: Record<string, any> = {
      'vnp_Version': VNPAY_CONSTANTS.VERSION,
      'vnp_Command': VNPAY_CONSTANTS.COMMAND_PAY,
      'vnp_TmnCode': tmnCode,
      'vnp_Locale': request.language,
      'vnp_CurrCode': VNPAY_CONSTANTS.CURRENCY,
      'vnp_TxnRef': paymentUtils.createPaymentReference(identifier, payment.id),
      'vnp_OrderInfo': request.orderId || `Thanh toan cho ma GD:${paymentUtils.createPaymentReference(identifier, payment.id)}`,
      'vnp_OrderType': VNPAY_CONSTANTS.ORDER_TYPE,
      'vnp_Amount': request.amount * 100,
      'vnp_ReturnUrl': returnUrl,
      'vnp_IpAddr': ipAddr,
      'vnp_CreateDate': createDate,
      'vnp_ExpireDate': moment(createDate).add(VNPAY_CONSTANTS.TRANSACTION_TIMEOUT, 'm').format('YYYYMMDDHHmmss')
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
  };

  const processReturn = async (paymentId: string, params: VNPayReturn): Promise<PaymentResult> => {
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ?',
      [paymentId]
    );

    if (payments.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    const payment = payments[0];
    await validatePayment(paymentId, payment.orderId, parseInt(params.vnp_Amount) / 100);
    await processPaymentTransaction(paymentId, payment.orderId, params);

    return {
      success: params.vnp_ResponseCode === '00',
      code: params.vnp_ResponseCode,
      message: paymentUtils.getResponseMessage(params.vnp_ResponseCode),  
      orderId: payment.orderId,
      amount: parseInt(params.vnp_Amount) / 100,
      transactionNo: params.vnp_TransactionNo,
      bankCode: params.vnp_BankCode
    };
  };

  const processIPN = async (paymentId: string, params: VNPayReturn): Promise<PaymentResult> => {
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ?',
      [paymentId]
    );

    if (payments.length === 0) {
      return {
        success: false,
        code: '01',
        message: PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND,  
      };
    }

    const payment = payments[0];
    
    if (payment.status !== PAYMENT_STATUS.PENDING) {
      return {
        success: false,
        code: '02',
        message: PAYMENT_ERROR_MESSAGES.PAYMENT_ALREADY_PROCESSED,  
      };
    }

    try {
      await validatePayment(paymentId, payment.orderId, parseInt(params.vnp_Amount) / 100);
      await processPaymentTransaction(paymentId, payment.orderId, params, true);
    } catch (error) {
      return {
        success: false,
        code: '04',
        message: error instanceof Error ? error.message : PAYMENT_ERROR_MESSAGES.INVALID_AMOUNT,  
      };
    }

    return {
      success: params.vnp_ResponseCode === '00',
      code: params.vnp_ResponseCode,
      message: paymentUtils.getResponseMessage(params.vnp_ResponseCode),  
    };
  };

  const queryTransaction = async (identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult> => {
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ?',
      [request.paymentId]
    );

    if (payments.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    const payment = payments[0];
    const date = new Date();
    const vnp_TmnCode = config.get('vnp_TmnCode');
    const secretKey = config.get('vnp_HashSecret');
    const vnp_Api = config.get('vnp_Api');

    const vnp_RequestId = moment(date).format('HHmmss');
    const vnp_CreateDate = moment(date).format('YYYYMMDDHHmmss');

    const data = `${vnp_RequestId}|${VNPAY_CONSTANTS.VERSION}|${VNPAY_CONSTANTS.COMMAND_QUERY}|${vnp_TmnCode}|${paymentUtils.createPaymentReference(identifier, payment.id)}|${request.transDate}|${vnp_CreateDate}|${ipAddr}|Truy van GD ma:${paymentUtils.createPaymentReference(identifier, payment.id)}`;
    
    const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);
    
    const dataObj = {
      'vnp_RequestId': vnp_RequestId,
      'vnp_Version': VNPAY_CONSTANTS.VERSION,
      'vnp_Command': VNPAY_CONSTANTS.COMMAND_QUERY,
      'vnp_TmnCode': vnp_TmnCode,
      'vnp_TxnRef': paymentUtils.createPaymentReference(identifier, payment.id),
      'vnp_OrderInfo': `Truy van GD ma: ${paymentUtils.createPaymentReference(identifier, payment.id)}`,
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
  };

  const refundTransaction = async (identifier: string, request: CreateRefund, ipAddr: string): Promise<RefundResult> => {
    const date = new Date();
    const vnp_TmnCode = config.get('vnp_TmnCode');
    const secretKey = config.get('vnp_HashSecret');
    const vnp_Api = config.get('vnp_Api');

    const vnp_RequestId = moment(date).format('HHmmss');
    const vnp_CreateDate = moment(date).format('YYYYMMDDHHmmss');
    
    const payments = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM payments WHERE id = ? AND status = ?',
      [request.paymentId, PAYMENT_STATUS.COMPLETED]
    );

    if (payments.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.PAYMENT_NOT_FOUND);
    }

    const payment = payments[0];
    const vnp_TransactionNo = payment.paymentDetails!.vnp_TransactionNo;

    const orders = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM orders WHERE id = ? AND status = ?',
      [payment.orderId, ORDER_STATUS.COMPLETED]
    );

    if (orders.length === 0) {
      throw new Error(PAYMENT_ERROR_MESSAGES.ORDER_NOT_FOUND);
    }

    const order = orders[0];

    const data = `${vnp_RequestId}|${VNPAY_CONSTANTS.VERSION}|${VNPAY_CONSTANTS.COMMAND_REFUND}|${vnp_TmnCode}|${request.transactionType}|${paymentUtils.createPaymentReference(identifier, payment.id)}|${order.finalAmount}|${order.finalAmount * 100}|${vnp_TransactionNo}|${vnp_CreateDate}|${identifier}|${vnp_CreateDate}|${ipAddr}|Hoan tien GD ma:${paymentUtils.createPaymentReference(identifier, payment.id)} voi ly do:${request.reason}`;
    
    const vnp_SecureHash = cryptoService.createSHA512Signature(data, secretKey);

    const dataObj = {
      'vnp_RequestId': vnp_RequestId,
      'vnp_Version': VNPAY_CONSTANTS.VERSION,
      'vnp_Command': VNPAY_CONSTANTS.COMMAND_REFUND,
      'vnp_TmnCode': vnp_TmnCode,
      'vnp_TransactionType': request.transactionType,
      'vnp_TxnRef': paymentUtils.createPaymentReference(identifier, payment.id),
      'vnp_Amount': order.finalAmount * 100,
      'vnp_TransactionNo': vnp_TransactionNo,
      'vnp_CreateBy': identifier,
      'vnp_OrderInfo': `Hoan tien GD ma:${paymentUtils.createPaymentReference(identifier, payment.id)} voi ly do:${request.reason}`,
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
    
    if (body.responseCode !== '00') {
      throw new Error(body.message);
    }

    const refundId = await processRefundTransaction(identifier, payment.id, request, body);

    return {
      responseCode: body.responseCode,
      message: body.message,
      refundId
    };
  };

  return {
    createPaymentUrl,
    processReturn,
    processIPN,
    queryTransaction,
    refundTransaction
  };
}

export function createCryptoService(): ICryptoService {
  return {
    createSHA512Signature(data: string, secretKey: string): string {
      return cryptoUtils.createSHA512Signature(data, secretKey);
    },

    validateSignature(params: Record<string, any>, secretKey: string, secureHash: string): boolean {
      return cryptoUtils.validateSignature(params, secretKey, secureHash);
    },

    sortObject(obj: Record<string, any>): Record<string, any> {
      return paymentUtils.sortObject(obj);
    }
  };
}

// Create crypto service instance
const cryptoService = createCryptoService();