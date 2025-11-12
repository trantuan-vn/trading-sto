import { UserDO } from '../ws/infrastructure/UserDO';
import {
  CreatePricePolicy,
  UpdatePricePolicy,
  ServicePriceCalculationRequest,
  UserPriceCalculationRequest,
  IPriceInfrastructureService,
  PricePolicySchema,
  // PriceCalculationLogSchema
} from './domain';

export function createPriceInfrastructureService(userDO: UserDO): IPriceInfrastructureService {

  const pricePolicies = userDO.table('price_policies', PricePolicySchema, { userScoped: true });
  // const priceCalculations = userDO.table('price_calculations', PriceCalculationLogSchema, { userScoped: true });
  
  // Helper methods
  function isPolicyApplicable(policy: any, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): boolean {
    const conditions = policy.conditions || {};
    
    // Check target specific conditions
    if (policy.targetType === 'SERVICE' && 'serviceId' in request) {
      if (policy.targetIds && policy.targetIds.length > 0) {
        if (!policy.targetIds.includes(request.serviceId)) {
          return false;
        }
      }
    }

    if (policy.targetType === 'USER' && 'userId' in request) {
      if (policy.targetIds && policy.targetIds.length > 0) {
        if (!policy.targetIds.includes(request.userId)) {
          return false;
        }
      }
    }

    // Check user role for user pricing
    if (policy.targetType === 'USER' && 'userRole' in request && conditions.userRoles) {
      if (!conditions.userRoles.includes(request.userRole)) {
        return false;
      }
    }

    // Check usage conditions
    if (policy.type === 'USAGE_BASED' && 'currentCalls' in request && conditions.maxCalls) {
      if (request.currentCalls ?? 0 >= conditions.maxCalls) {
        return false;
      }
    }

    // Check minimum quantity
    if (conditions.minQuantity && 'quantity' in request && request.quantity) {
      if (request.quantity < conditions.minQuantity) {
        return false;
      }
    }

    // Check date validity
    const now = new Date();
    if (policy.startDate && new Date(policy.startDate) > now) {
      return false;
    }
    if (policy.endDate && new Date(policy.endDate) < now) {
      return false;
    }

    return true;
  }

  function calculateDiscount(policy: any, currentPrice: number, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): number {
    switch (policy.type) {
      case 'PERCENTAGE':
        return currentPrice * (policy.value / 100);
      case 'FIXED_AMOUNT':
        return policy.value;
      case 'TIERED':
        return calculateTieredDiscount(policy, currentPrice, request);
      case 'USAGE_BASED':
        return calculateUsageBasedDiscount(policy, request);
      default:
        return 0;
    }
  }

  function calculateTieredDiscount(policy: any, currentPrice: number, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): number {
    const tiers = policy.conditions?.tiers || [];
    
    // For service usage tiers
    if ('currentCalls' in request && policy.targetType === 'SERVICE') {
      for (const tier of tiers.reverse()) {
        if (request.currentCalls ?? 0 >= tier.minUsage) {
          if (tier.type === 'PERCENTAGE') {
            return currentPrice * (tier.value / 100);
          } else {
            return tier.value;
          }
        }
      }
    }
    
    // For price-based tiers
    for (const tier of tiers.reverse()) {
      if (currentPrice >= tier.minAmount) {
        if (tier.type === 'PERCENTAGE') {
          return currentPrice * (tier.value / 100);
        } else {
          return tier.value;
        }
      }
    }
    return 0;
  }

  function calculateUsageBasedDiscount(policy: any, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): number {
    if (!('currentCalls' in request)) return 0;
    
    const conditions = policy.conditions || {};
    const currentCalls = request.currentCalls || 0;
    
    // Discount based on usage percentage
    if (conditions.usagePercentage) {
      const maxCalls = conditions.maxCalls || 1;
      const usageRatio = currentCalls / maxCalls;
      
      if (usageRatio >= conditions.usagePercentage) {
        return policy.value;
      }
    }
    
    return 0;
  }
  
  return {
    async createPricePolicy(request: CreatePricePolicy): Promise<any> {
      const policyData = PricePolicySchema.parse({
        ...request,
        status: 'ACTIVE',
      });
      return await pricePolicies.create(policyData);
    },

    async updatePricePolicy(policyId: string, request: UpdatePricePolicy): Promise<any> {
      const existingPolicy = await pricePolicies.findById(policyId);
      if (!existingPolicy) {
        throw new Error('Price policy not found');
      }

      const updateData = {
        ...request,
      };

      return await pricePolicies.update(policyId, updateData);
    },

    async getPricePolicies(status?: string): Promise<any[]> {
      if (status) {
        return pricePolicies.where('status', '==', status).orderBy('priority', 'desc').get();
      }
      return pricePolicies.orderBy('priority', 'desc').get();
    },

    async getPricePolicy(policyId: string): Promise<any> {
      const policy = await pricePolicies.findById(policyId);
      if (!policy) {
        throw new Error('Price policy not found');
      }
      return policy;
    },

    async deletePricePolicy(policyId: string): Promise<void> {
      const policy = await pricePolicies.findById(policyId);
      if (!policy) {
        throw new Error('Price policy not found');
      }
      await pricePolicies.delete(policyId);
    },

    async calculateServicePrice(request: ServicePriceCalculationRequest): Promise<any> {
      const activePolicies = await pricePolicies
        .where('status', '==', 'ACTIVE')
        .where('targetType', '==', 'SERVICE')
        .orderBy('priority', 'desc')
        .get();

      let finalPrice = request.basePrice;
      let appliedPolicies = [];
      let totalDiscount = 0;

      for (const policy of activePolicies) {
        if (isPolicyApplicable(policy, request)) {
          const discount = calculateDiscount(policy, finalPrice, request);
          finalPrice = Math.max(0, finalPrice - discount);
          totalDiscount += discount;
          
          appliedPolicies.push({
            policyId: policy.id,
            policyName: policy.name,
            discount: discount,
            type: policy.type
          });
        }
      }

      // // Log calculation
      // await priceCalculations.create({
      //   basePrice: request.basePrice,
      //   finalPrice: finalPrice,
      //   totalDiscount: totalDiscount,
      //   appliedPolicies: appliedPolicies,
      //   serviceId: request.serviceId,
      //   customerId: request.customerId,
      //   targetType: 'SERVICE'
      // });

      return {
        basePrice: request.basePrice,
        finalPrice: finalPrice, 
        totalDiscount: totalDiscount,
        appliedPolicies: appliedPolicies, 
        currency: request.currency || 'VND',
        serviceId: request.serviceId
      };
    },

    async calculateUserPrice(request: UserPriceCalculationRequest): Promise<any> {
      const activePolicies = await pricePolicies
        .where('status', '==', 'ACTIVE')
        .where('targetType', '==', 'USER')
        .orderBy('priority', 'desc')
        .get();

      let finalPrice = request.basePrice;
      let appliedPolicies = [];
      let totalDiscount = 0;

      for (const policy of activePolicies) {
        if (isPolicyApplicable(policy, request)) {
          const discount = calculateDiscount(policy, finalPrice, request);
          finalPrice = Math.max(0, finalPrice - discount);
          totalDiscount += discount;
          
          appliedPolicies.push({
            policyId: policy.id,
            policyName: policy.name,
            discount: discount,
            type: policy.type
          });
        }
      }

      // // Log calculation
      // await priceCalculations.create({
      //   basePrice: request.basePrice,
      //   finalPrice: finalPrice,
      //   totalDiscount: totalDiscount,
      //   appliedPolicies: appliedPolicies,
      //   userId: request.userId,
      //   targetType: 'USER'
      // });

      return {
        basePrice: request.basePrice,
        finalPrice: finalPrice,
        totalDiscount: totalDiscount,
        appliedPolicies: appliedPolicies,
        currency: request.currency || 'VND',
        userId: request.userId
      };
    },

    async updatePolicyStatus(policyId: string, status: string): Promise<any> {
      const policy = await pricePolicies.findById(policyId);
      if (!policy) {
        throw new Error('Price policy not found');
      }

      return await pricePolicies.update(policyId, { status: status as "ACTIVE" | "INACTIVE"});
    },
  };
}