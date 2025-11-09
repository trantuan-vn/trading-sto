import { z } from 'zod';

// Schemas
export const PricePolicySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'TIERED', 'USAGE_BASED']),
  value: z.number().min(0),
  applicableTo: z.enum(['ALL', 'SPECIFIC']),
  targetType: z.enum(['SERVICE', 'USER']),
  targetIds: z.array(z.string()).optional(),
  conditions: z.object({
    userRoles: z.array(z.enum(['member', 'admin'])).optional(),
    maxCalls: z.number().min(0).optional(),
    minQuantity: z.number().min(1).optional(),
    usagePercentage: z.number().min(0).max(100).optional(),
    tiers: z.array(z.object({
      minAmount: z.number().optional(),
      minUsage: z.number().optional(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number(),
    })).optional(),
  }).optional(),
  priority: z.number().min(0).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const CreatePricePolicySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'TIERED', 'USAGE_BASED']),
  value: z.number().min(0),
  applicableTo: z.enum(['ALL', 'SPECIFIC']),
  targetType: z.enum(['SERVICE', 'USER']),
  targetIds: z.array(z.string()).optional(),
  conditions: z.object({
    userRoles: z.array(z.enum(['member', 'admin'])).optional(),
    maxCalls: z.number().min(0).optional(),
    minQuantity: z.number().min(1).optional(),
    usagePercentage: z.number().min(0).max(100).optional(),
    tiers: z.array(z.object({
      minAmount: z.number().optional(),
      minUsage: z.number().optional(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number(),
    })).optional(),
  }).optional(),
  priority: z.number().min(0).default(0),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const UpdatePricePolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'TIERED', 'USAGE_BASED']).optional(),
  value: z.number().min(0).optional(),
  applicableTo: z.enum(['ALL', 'SPECIFIC']).optional(),
  targetType: z.enum(['SERVICE', 'USER']).optional(),
  targetIds: z.array(z.string()).optional(),
  conditions: z.object({
    userRoles: z.array(z.enum(['member', 'admin'])).optional(),
    maxCalls: z.number().min(0).optional(),
    minQuantity: z.number().min(1).optional(),
    usagePercentage: z.number().min(0).max(100).optional(),
    tiers: z.array(z.object({
      minAmount: z.number().optional(),
      minUsage: z.number().optional(),
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number(),
    })).optional(),
  }).optional(),
  priority: z.number().min(0).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const ServicePriceCalculationRequestSchema = z.object({
  basePrice: z.number().min(0),
  serviceId: z.string(),
  serviceName: z.string().optional(),
  currentCalls: z.number().min(0).optional(),
  maxCalls: z.number().min(0).optional(),
  quantity: z.number().min(1).optional().default(1),
  customerId: z.string().optional(),
  currency: z.string().optional().default('VND'),
});

export const UserPriceCalculationRequestSchema = z.object({
  basePrice: z.number().min(0),
  userId: z.string(),
  userRole: z.enum(['member', 'admin']).optional(),
  userGroup: z.string().optional(),
  quantity: z.number().min(1).optional().default(1),
  currency: z.string().optional().default('VND'),
});

export const PriceCalculationLogSchema = z.object({
  basePrice: z.number().min(0),
  finalPrice: z.number().min(0),
  totalDiscount: z.number().min(0),
  appliedPolicies: z.array(z.object({
    policyId: z.string(),
    policyName: z.string(),
    discount: z.number(),
    type: z.string(),
  })),
  serviceId: z.string().optional(),
  userId: z.string().optional(),
  customerId: z.string().optional(),
  targetType: z.enum(['SERVICE', 'USER']),
});

// Types
export type PricePolicy = z.infer<typeof PricePolicySchema>;
export type CreatePricePolicy = z.infer<typeof CreatePricePolicySchema>;
export type UpdatePricePolicy = z.infer<typeof UpdatePricePolicySchema>;
export type ServicePriceCalculationRequest = z.infer<typeof ServicePriceCalculationRequestSchema>;
export type UserPriceCalculationRequest = z.infer<typeof UserPriceCalculationRequestSchema>;
export type PriceCalculationLog = z.infer<typeof PriceCalculationLogSchema>;

// Domain Interfaces
export interface IPriceInfrastructureService {
  createPricePolicy(request: CreatePricePolicy): Promise<any>;
  updatePricePolicy(policyId: string, request: UpdatePricePolicy): Promise<any>;
  getPricePolicies(status?: string): Promise<any[]>;
  getPricePolicy(policyId: string): Promise<any>;
  deletePricePolicy(policyId: string): Promise<void>;
  calculateServicePrice(request: ServicePriceCalculationRequest): Promise<any>;
  calculateUserPrice(request: UserPriceCalculationRequest): Promise<any>;
  updatePolicyStatus(policyId: string, status: string): Promise<any>;
}

// Ví dụ sử dụng:
// {
//   "name": "Giảm 10% cho Service API",
//   "type": "PERCENTAGE", 
//   "value": 10,
//   "applicableTo": "SPECIFIC",
//   "targetType": "SERVICE",
//   "targetIds": ["api-service-1"],
//   "conditions": {
//     "maxCalls": 1000
//   }
// }

// {
//   "name": "Giảm giá cho thành viên",
//   "type": "FIXED_AMOUNT",
//   "value": 50000,
//   "applicableTo": "ALL",
//   "targetType": "USER",
//   "conditions": {
//     "userRoles": ["member"]
//   }
// }

// {
//   "name": "Giảm giá theo usage",
//   "type": "USAGE_BASED", 
//   "value": 100000,
//   "applicableTo": "SPECIFIC",
//   "targetType": "SERVICE",
//   "targetIds": ["api-service-1"],
//   "conditions": {
//     "usagePercentage": 80,
//     "maxCalls": 1000
//   }
// }