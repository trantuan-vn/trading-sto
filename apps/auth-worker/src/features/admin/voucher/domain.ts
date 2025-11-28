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

export const VoucherStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']);

// Types
export type Voucher = z.infer<typeof VoucherSchema>;
export type ApplyVoucher = z.infer<typeof ApplyVoucherSchema>;
export type ValidateVoucherRequest = z.infer<typeof ValidateVoucherRequestSchema>;

// Domain Interfaces
export interface IVoucherInfrastructureService {
  createVoucher(request: Voucher): Promise<any>;
  applyServiceVoucher(request: ApplyVoucher): Promise<any>;
  applyUserVoucher(request: ApplyVoucher): Promise<any>;
  getVouchers(status?: string, targetType?: string): Promise<any[]>;
  getVoucherByCode(voucherCode: string): Promise<any>;
  validateServiceVoucher(request: ValidateVoucherRequest): Promise<any>;
  validateUserVoucher(request: ValidateVoucherRequest): Promise<any>;
  updateVoucherStatus(voucherId: string, status: string): Promise<any>;
  getAvailableServiceVouchers(serviceId?: string, basePrice?: number): Promise<any[]>;
  getAvailableUserVouchers(userId?: string, userRole?: string, basePrice?: number): Promise<any[]>;
}