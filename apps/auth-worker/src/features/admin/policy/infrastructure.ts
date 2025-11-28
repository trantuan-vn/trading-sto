import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  PricePolicy,
  ServicePriceCalculationRequest,
  UserPriceCalculationRequest,
  IPriceInfrastructureService,
} from './domain';

export function createPriceInfrastructureService(userDO: DurableObjectStub<UserDO>): IPriceInfrastructureService {
  
  const executeRepositoryAction = async (operation: string, data: any, table: string = 'price_policies'): Promise<any> => {
    const response = await userDO.fetch('http://user.internal/repository/action', {
      method: 'POST',
      body: JSON.stringify({ table, operation, data })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to ${operation} ${table}: ${errorText}`);
    }
    
    return await response.json();
  };

  const executeRepositorySelect = async (sql: string, params: any[] = []): Promise<any[]> => {
    const response = await userDO.fetch('http://user.internal/repository/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }
    
    return await response.json();
  };

  // Helper methods
  const isPolicyApplicable = (policy: any, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): boolean => {
    const conditions = policy.conditions || {};
    const now = new Date();

    // Check target specific conditions
    if (policy.targetType === 'SERVICE' && 'serviceId' in request) {
      if (policy.targetIds?.length && !policy.targetIds.includes(request.serviceId)) {
        return false;
      }
    }

    if (policy.targetType === 'USER' && 'userId' in request) {
      if (policy.targetIds?.length && !policy.targetIds.includes(request.userId)) {
        return false;
      }
    }

    // Check user role
    if (policy.targetType === 'USER' && 'userRole' in request && conditions.userRoles) {
      if (!conditions.userRoles.includes(request.userRole)) {
        return false;
      }
    }

    // Check usage conditions
    if (policy.type === 'USAGE_BASED' && 'currentCalls' in request && conditions.maxCalls) {
      if ((request.currentCalls ?? 0) >= conditions.maxCalls) {
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
    if (policy.startDate && new Date(policy.startDate) > now) return false;
    if (policy.endDate && new Date(policy.endDate) < now) return false;

    return true;
  };

  const calculateDiscount = (policy: any, currentPrice: number, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): number => {
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
  };

  const calculateTieredDiscount = (policy: any, currentPrice: number, request: any): number => {
    const tiers = [...(policy.conditions?.tiers || [])].sort((a, b) => 
      (a.minAmount || a.minUsage || 0) - (b.minAmount || b.minUsage || 0)
    );
    
    // Tìm tier phù hợp (tier cao nhất mà điều kiện thỏa mãn)
    let applicableTier = null;
    for (const tier of tiers) {
      if (tier.minAmount && currentPrice >= tier.minAmount) {
        applicableTier = tier;
      } else if (tier.minUsage && 'currentCalls' in request && (request.currentCalls ?? 0) >= tier.minUsage) {
        applicableTier = tier;
      }
    }
    
    if (!applicableTier) return 0;
    
    return applicableTier.type === 'PERCENTAGE' 
      ? currentPrice * (applicableTier.value / 100) 
      : applicableTier.value;
  };

  const calculateUsageBasedDiscount = (policy: any, request: ServicePriceCalculationRequest | UserPriceCalculationRequest): number => {
    if (!('currentCalls' in request)) return 0;
    
    const conditions = policy.conditions || {};
    const currentCalls = request.currentCalls || 0;
    const maxCalls = conditions.maxCalls || 1;
    
    if (conditions.usagePercentage && (currentCalls / maxCalls) >= conditions.usagePercentage) {
      return policy.value;
    }
    
    return 0;
  };

  const calculatePrice = async (request: ServicePriceCalculationRequest | UserPriceCalculationRequest, targetType: 'SERVICE' | 'USER') => {
    const activePolicies = await executeRepositorySelect(
      'select * from price_policies where status = ? and target_type = ? order by priority desc',
      ['ACTIVE', targetType]
    );

    let finalPrice = request.basePrice;
    let totalDiscount = 0;
    const appliedPolicies = [];

    for (const policy of activePolicies) {
      if (isPolicyApplicable(policy, request)) {
        const discount = calculateDiscount(policy, finalPrice, request);
        finalPrice = Math.max(0, finalPrice - discount);
        totalDiscount += discount;
        
        appliedPolicies.push({
          policyId: policy.id,
          policyName: policy.name,
          discount,
          type: policy.type
        });
      }
    }

    return {
      basePrice: request.basePrice,
      finalPrice,
      totalDiscount,
      appliedPolicies,
      currency: request.currency || 'VND',
      [targetType === 'SERVICE' ? 'serviceId' : 'userId']: targetType === 'SERVICE' 
        ? (request as ServicePriceCalculationRequest).serviceId 
        : (request as UserPriceCalculationRequest).userId
    };
  };

  return {
    createPricePolicy: (request: PricePolicy) => 
      executeRepositoryAction('create', { ...request, status: 'ACTIVE' }),

    updatePricePolicy: (policyId: string, request: PricePolicy) => 
      executeRepositoryAction('update', { id: policyId, ...request }),

    getPricePolicies: (limit: number, offset: number, status?: string) => 
      executeRepositorySelect(
        status 
          ? 'select * from price_policies where status = ? order by priority desc limit ? offset ?'
          : 'select * from price_policies order by priority desc limit ? offset ?',
        status ? [status, limit, offset] : [limit, offset]
      ),

    getPricePolicy: (policyId: string) => 
      executeRepositoryAction('findById', { id: policyId }),

    deletePricePolicy: (policyId: string) => 
      executeRepositoryAction('delete', { id: policyId }),

    updatePolicyStatus: (policyId: string, status: string) => 
      executeRepositoryAction('update', { id: policyId, data: { status } }),

    calculateServicePrice: (request: ServicePriceCalculationRequest) => 
      calculatePrice(request, 'SERVICE'),

    calculateUserPrice: (request: UserPriceCalculationRequest) => 
      calculatePrice(request, 'USER'),
  };
}