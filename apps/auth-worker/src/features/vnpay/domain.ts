import { z } from 'zod';

// Schemas
export const CreatePaymentSchema = z.object({
  amount: z.number().min(1000, 'Amount must be at least 1,000 VND'),
  bankCode: z.string().optional(),
  language: z.enum(['vn', 'en']).default('vn'),
  orderInfo: z.string().max(255).optional(),
  orderType: z.string().default('other'),
});

export const PaymentQuerySchema = z.object({
  orderId: z.string(),
  transDate: z.string(),
});

export const RefundSchema = z.object({
  orderId: z.string(),
  transDate: z.string(),
  amount: z.number().min(1000),
  transType: z.string(),
  user: z.string(),
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
  createPaymentUrl(request: CreatePayment, ipAddr: string): Promise<PaymentUrlResult>;
  processReturn(params: VNPayReturn): Promise<PaymentResult>;
  processIPN(params: VNPayIPN): Promise<PaymentResult>;
  queryTransaction(request: PaymentQuery, ipAddr: string): Promise<QueryDRResult>;
  refundTransaction(request: RefundRequest, ipAddr: string): Promise<RefundResult>;
}

export interface IPaymentRepository {
  findOrderById(orderId: string): Promise<{ exists: boolean; amount?: number; status?: string }>;
  updatePaymentStatus(orderId: string, status: string, transactionData: any): Promise<void>;
  createRefundRecord(refundData: any): Promise<string>;
}

export interface ICryptoService {
  createSHA512Signature(data: string, secretKey: string): string;
  validateSignature(params: Record<string, any>, secretKey: string, secureHash: string): boolean;
  sortObject(obj: Record<string, any>): Record<string, any>;
}