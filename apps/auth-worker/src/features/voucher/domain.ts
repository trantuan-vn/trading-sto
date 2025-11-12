import { z } from 'zod';

// Schemas
export const VoucherSchema = z.object({
  code: z.string().min(3).max(20),
  name: z.string().min(1).max(100),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'USAGE_BASED', 'TIERED']),
  discountValue: z.number().min(0),
  minOrderAmount: z.number().min(0).optional(),
  maxDiscountAmount: z.number().min(0).optional(),
  usageLimit: z.number().min(1).optional(),
  usedCount: z.number().min(0).default(0),
  targetType: z.enum(['SERVICE', 'USER', 'BOTH']).default('BOTH'),
  applicableServices: z.array(z.string()).default([]),
  applicableUsers: z.array(z.string()).default([]),
  userRoles: z.array(z.enum(['member', 'admin'])).default([]),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']).default('ACTIVE'),
  conditions: z.object({
    tiers: z.array(z.object({
      minAmount: z.number(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number(),
    })).optional(),
    maxCalls: z.number().min(0).optional(),
    minUsage: z.number().min(0).optional(),
  }).optional(),
});

export const CreateVoucherSchema = z.object({
  code: z.string().min(3).max(20),
  name: z.string().min(1).max(100),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'USAGE_BASED', 'TIERED']),
  discountValue: z.number().min(0),
  minOrderAmount: z.number().min(0).optional(),
  maxDiscountAmount: z.number().min(0).optional(),
  usageLimit: z.number().min(1).optional(),
  targetType: z.enum(['SERVICE', 'USER', 'BOTH']).default('BOTH'),
  applicableServices: z.array(z.string()).optional(),
  applicableUsers: z.array(z.string()).optional(),
  userRoles: z.array(z.enum(['member', 'admin'])).optional(),
  startDate: z.string(),
  endDate: z.string(),
  conditions: z.object({
    tiers: z.array(z.object({
      minAmount: z.number(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number(),
    })).optional(),
    maxCalls: z.number().min(0).optional(),
    minUsage: z.number().min(0).optional(),
  }).optional(),
});

export const ApplyVoucherSchema = z.object({
  voucherCode: z.string().min(3).max(20),
  basePrice: z.number().min(0),
  orderAmount: z.number().min(0),
  serviceId: z.string().optional(),
  currentCalls: z.number().min(0).optional(),
  userId: z.string().optional(),
  userRole: z.enum(['member', 'admin']).optional(),
});

export const ValidateVoucherRequestSchema = z.object({
  voucherCode: z.string().min(3).max(20),
  basePrice: z.number().min(0),
  orderAmount: z.number().min(0),
  serviceId: z.string().optional(),
  currentCalls: z.number().min(0).optional(),
  userId: z.string().optional(),
  userRole: z.enum(['member', 'admin']).optional(),
});

// export const VoucherUsageSchema = z.object({
//   voucherId: z.string(),
//   voucherCode: z.string(),
//   targetType: z.enum(['SERVICE', 'USER']),
//   serviceId: z.string().optional(),
//   userId: z.string().optional(),
//   userRole: z.enum(['member', 'admin']).optional(),
//   customerId: z.string().optional(),
//   basePrice: z.number().min(0),
//   discountAmount: z.number().min(0),
//   finalPrice: z.number().min(0),
//   appliedAt: z.string(),
// });

// Types
export type Voucher = z.infer<typeof VoucherSchema>;
export type CreateVoucher = z.infer<typeof CreateVoucherSchema>;
export type ApplyVoucher = z.infer<typeof ApplyVoucherSchema>;
export type ValidateVoucherRequest = z.infer<typeof ValidateVoucherRequestSchema>;
// export type VoucherUsage = z.infer<typeof VoucherUsageSchema>;

// Domain Interfaces
export interface IVoucherInfrastructureService {
  createVoucher(request: CreateVoucher): Promise<any>;
  applyServiceVoucher(request: ApplyVoucher): Promise<any>;
  applyUserVoucher(request: ApplyVoucher): Promise<any>;
  getVouchers(status?: string, targetType?: string): Promise<any[]>;
  getVoucherByCode(voucherCode: string): Promise<any>;
  validateServiceVoucher(request: ValidateVoucherRequest): Promise<any>;
  validateUserVoucher(request: ValidateVoucherRequest): Promise<any>;
  updateVoucherStatus(voucherId: string, status: string): Promise<any>;
  // getVoucherUsage(voucherId: string): Promise<any[]>;
  getAvailableServiceVouchers(serviceId?: string, basePrice?: number): Promise<any[]>;
  getAvailableUserVouchers(userId?: string, userRole?: string, basePrice?: number): Promise<any[]>;
}

// VÍ DỤ VOUCHER CHO SERVICE VÀ USER

// 1. Voucher cho Service cụ thể
// {
//   "code": "API20OFF",
//   "name": "Giảm 20% cho API Service",
//   "type": "PERCENTAGE",
//   "discountValue": 20,
//   "targetType": "SERVICE",
//   "applicableServices": ["api_premium", "api_enterprise"],
//   "minOrderAmount": 1000000,
//   "maxDiscountAmount": 500000,
//   "usageLimit": 100,
//   "startDate": "2024-01-01T00:00:00Z",
//   "endDate": "2024-12-31T23:59:59Z"
// }

// 2. Voucher cho User thành viên
// {
//   "code": "MEMBER10",
//   "name": "Giảm 10% cho thành viên",
//   "type": "PERCENTAGE", 
//   "discountValue": 10,
//   "targetType": "USER",
//   "userRoles": ["member"],
//   "minOrderAmount": 0,
//   "usageLimit": 1000,
//   "startDate": "2024-01-01T00:00:00Z",
//   "endDate": "2024-12-31T23:59:59Z"
// }

// 3. Voucher cho cả Service và User
// {
//   "code": "WELCOME50",
//   "name": "Giảm 50K cho new user",
//   "type": "FIXED_AMOUNT",
//   "discountValue": 50000,
//   "targetType": "BOTH",
//   "applicableUsers": ["new_user_1", "new_user_2"],
//   "minOrderAmount": 100000,
//   "usageLimit": 1,
//   "startDate": "2024-01-01T00:00:00Z", 
//   "endDate": "2024-12-31T23:59:59Z"
// }

// 4. Voucher dựa trên usage
// {
//   "code": "HIGHUSAGE",
//   "name": "Giảm giá cho usage cao",
//   "type": "USAGE_BASED",
//   "discountValue": 15,
//   "targetType": "SERVICE",
//   "conditions": {
//     "minUsage": 1000,
//     "maxCalls": 5000
//   },
//   "startDate": "2024-01-01T00:00:00Z",
//   "endDate": "2024-12-31T23:59:59Z"
// }