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

export const ServicePriceCalculationRequestSchema = z.object({
  basePrice: z.number().min(0),
  serviceId: z.string(),
  serviceName: z.string().optional(),
  currentCalls: z.number().min(0).optional(),
  maxCalls: z.number().min(0).optional(),
  quantity: z.number().min(1).optional().default(1),
  currency: z.string().optional().default('VND'),
});

export const UserPriceCalculationRequestSchema = z.object({
  basePrice: z.number().min(0),
  userId: z.string(),
  userRole: z.enum(['member', 'admin']).optional(),
  serviceId: z.string(),
  serviceName: z.string().optional(),
  currentCalls: z.number().min(0).optional(),
  maxCalls: z.number().min(0).optional(),
  quantity: z.number().min(1).optional().default(1),
  currency: z.string().optional().default('VND'),
});
export const PolicyIdSchema = z.string().uuid(); // hoặc regex phù hợp
export const StatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
// Types
export type PricePolicy = z.infer<typeof PricePolicySchema>;
export type ServicePriceCalculationRequest = z.infer<typeof ServicePriceCalculationRequestSchema>;
export type UserPriceCalculationRequest = z.infer<typeof UserPriceCalculationRequestSchema>;

// Domain Interfaces
export interface IPriceInfrastructureService {
  createPricePolicy(request: PricePolicy): Promise<any>;
  updatePricePolicy(policyId: string, request: PricePolicy): Promise<any>;
  getPricePolicies(limit: number, offset: number, status?: string): Promise<any[]>;
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