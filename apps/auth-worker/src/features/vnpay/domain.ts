import { z } from 'zod';
// Order Schema
export const OrderSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('VND'),
  status: z.enum(['pending', 'paid', 'failed', 'cancelled', 'refunded']).default('pending'),
  items: z.array(z.object({
    serviceId: z.string(),
    name: z.string(),
    price: z.number().positive(),
    quantity: z.number().int().positive()
  })),
});
// Payment Schema
export const PaymentSchema = z.object({
  orderId: z.string(),
  paymentMethod: z.enum(['credit_card', 'bank_transfer', 'ewallet', 'cod']),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).default('pending'),
  gateway: z.string().optional(),
  paymentDetails: z.record(z.any()).optional(),
});
// Refund Schema
export const RefundSchema = z.object({
  paymentId: z.string(),
  orderId: z.string(),
  transactionType: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).default('pending'),
  refundDetails: z.record(z.any()).optional(),
});

// Schemas
export const CreatePaymentSchema = z.object({
  amount: z.number().min(1000, 'Amount must be at least 1,000 VND'),
  bankCode: z.string(),
  language: z.enum(['vn', 'en']).default('vn'),
  orderInfo: OrderSchema,
});

export const PaymentQuerySchema = z.object({
  paymentId: z.string(),
  transDate: z.string(),
});

export const VNPayReturnSchema = z.object({
  vnp_SecureHash: z.string(),
  vnp_ResponseCode: z.string(),
  vnp_TxnRef: z.string(),
  vnp_Amount: z.string(),
  vnp_BankCode: z.string().optional(),
  vnp_BankTranNo: z.string().optional(),
  vnp_CardType: z.string().optional(),
  vnp_OrderInfo: z.string().optional(),
  vnp_PayDate: z.string().optional(),
  vnp_TransactionNo: z.string().optional(),
});

export const VNPayIPNSchema = z.object({
  vnp_SecureHash: z.string(),
  vnp_ResponseCode: z.string(),
  vnp_TxnRef: z.string(),
  vnp_Amount: z.string(),
  vnp_TransactionNo: z.string().optional(),
});

// Types
export type CreatePayment = z.infer<typeof CreatePaymentSchema>;
export type PaymentQuery = z.infer<typeof PaymentQuerySchema>;
export type RefundRequest = z.infer<typeof RefundSchema>;
export type VNPayReturn = z.infer<typeof VNPayReturnSchema>;
export type VNPayIPN = z.infer<typeof VNPayIPNSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Refund = z.infer<typeof RefundSchema>;

export interface PaymentResult {
  success: boolean;
  code: string;
  message: string;
  orderId?: string;
  amount?: number;
  transactionNo?: string;
  bankCode?: string;
}

export interface PaymentUrlResult {
  paymentUrl: string;
  orderId: string;
  amount: number;
}

export interface QueryDRResult {
  responseCode: string;
  message: string;
  transaction?: any;
}

export interface RefundResult {
  responseCode: string;
  message: string;
  refundId?: string;
}

// Domain Interfaces
export interface IVNPayService {
  createPaymentUrl(request: CreatePayment, ipAddr: string, identifier: string): Promise<string>;
  processReturn(paymentId: string, params: VNPayReturn): Promise<PaymentResult>;
  processIPN(paymentId: string, params: VNPayReturn): Promise<PaymentResult>;
  queryTransaction(identifier: string, request: PaymentQuery, ipAddr: string): Promise<QueryDRResult>;
  refundTransaction(identifier: string, request: RefundRequest, ipAddr: string): Promise<RefundResult>;
}

export interface ICryptoService {
  createSHA512Signature(data: string, secretKey: string): string;
  validateSignature(params: Record<string, any>, secretKey: string, secureHash: string): boolean;
  sortObject(obj: Record<string, any>): Record<string, any>;
}