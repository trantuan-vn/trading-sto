import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  Voucher,
  ApplyVoucher,
  ValidateVoucherRequest,
  IVoucherInfrastructureService,
} from './domain';

export function createVoucherInfrastructureService(userDO: DurableObjectStub<UserDO>): IVoucherInfrastructureService {
  
  const executeRepositoryAction = async (operation: string, data: any, table: string = 'vouchers'): Promise<any> => {
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
  const isVoucherApplicable = (voucher: any, request: any, targetType: 'SERVICE' | 'USER'): boolean => {
    const now = new Date();
    const startDate = new Date(voucher.startDate);
    const endDate = new Date(voucher.endDate);

    // Check target type
    if (targetType === 'SERVICE' && voucher.targetType !== 'SERVICE' && voucher.targetType !== 'BOTH') {
      return false;
    }

    if (targetType === 'USER' && voucher.targetType !== 'USER' && voucher.targetType !== 'BOTH') {
      return false;
    }

    // Check status
    if (voucher.status !== 'ACTIVE') {
      return false;
    }

    // Check date validity
    if (now < startDate || now > endDate) {
      return false;
    }

    // Check usage limit
    if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit) {
      return false;
    }

    // Check minimum order amount
    if (voucher.minOrderAmount && request.orderAmount < voucher.minOrderAmount) {
      return false;
    }

    // Service-specific checks
    if (targetType === 'SERVICE' && request.serviceId) {
      if (voucher.applicableServices?.length && !voucher.applicableServices.includes(request.serviceId)) {
        return false;
      }
    }

    // User-specific checks
    if (targetType === 'USER') {
      if (voucher.applicableUsers?.length && request.userId && !voucher.applicableUsers.includes(request.userId)) {
        return false;
      }

      if (voucher.userRoles?.length && request.userRole && !voucher.userRoles.includes(request.userRole)) {
        return false;
      }
    }

    // Usage-based conditions
    if (voucher.conditions && voucher.type === 'USAGE_BASED') {
      const { minUsage, maxCalls } = voucher.conditions;
      const currentCalls = request.currentCalls || 0;
      
      if (minUsage !== undefined && currentCalls < minUsage) {
        return false;
      }
      
      if (maxCalls !== undefined && currentCalls > maxCalls) {
        return false;
      }
    }

    return true;
  };

  const calculateDiscount = (voucher: any, basePrice: number, currentCalls: number): number => {
    let discount = 0;

    switch (voucher.type) {
      case 'PERCENTAGE':
        discount = basePrice * (voucher.discountValue / 100);
        if (voucher.maxDiscountAmount && discount > voucher.maxDiscountAmount) {
          discount = voucher.maxDiscountAmount;
        }
        break;

      case 'FIXED_AMOUNT':
        discount = voucher.discountValue;
        break;

      case 'USAGE_BASED':
        discount = calculateUsageBasedDiscount(voucher, basePrice, currentCalls);
        break;

      case 'TIERED':
        discount = calculateTieredDiscount(voucher, basePrice);
        break;
    }

    return Math.min(discount, basePrice);
  };

  const calculateUsageBasedDiscount = (voucher: any, basePrice: number, currentCalls: number): number => {
    if (voucher.conditions?.minUsage && voucher.conditions?.maxCalls) {
      const { minUsage, maxCalls } = voucher.conditions;
      
      if (currentCalls >= minUsage && currentCalls <= maxCalls) {
        const usageRange = maxCalls - minUsage;
        const currentPosition = currentCalls - minUsage;
        const discountMultiplier = currentPosition / usageRange;
        
        return (basePrice * (voucher.discountValue * discountMultiplier)) / 100;
      }
    }
    
    return voucher.discountValue;
  };

  const calculateTieredDiscount = (voucher: any, basePrice: number): number => {
    const tiers = voucher.conditions?.tiers || [];
    for (const tier of tiers.reverse()) {
      if (basePrice >= tier.minAmount) {
        return tier.type === 'PERCENTAGE' 
          ? basePrice * (tier.value / 100) 
          : tier.value;
      }
    }
    return 0;
  };

  return {
    async createVoucher(request: Voucher): Promise<any> {

      // Check if code already exists
      const existingVouchers = await executeRepositorySelect(
        'select * from vouchers where code = ?',
        [request.code]
      );

      if (existingVouchers.length > 0) {
        throw new Error('Voucher code already exists');
      }

      return await executeRepositoryAction('create', request);
    },

    async applyServiceVoucher(request: ApplyVoucher): Promise<any> {
      const { voucherCode, basePrice, serviceId } = request;
      
      // Find voucher by code
      const vouchers = await executeRepositorySelect(
        'select * from vouchers where code = ?',
        [voucherCode.toUpperCase()]
      );
      
      if (vouchers.length === 0) {
        throw new Error('Voucher not found');
      }

      const voucher = vouchers[0];

      // Validate voucher
      if (!isVoucherApplicable(voucher, request, 'SERVICE')) {
        throw new Error('Voucher is not applicable for this service');
      }

      // Calculate discount
      const discountAmount = calculateDiscount(voucher, basePrice, request.currentCalls || 0);

      // Update voucher usage count
      await executeRepositoryAction('update', {
        id: voucher.id,
        data: { usedCount: voucher.usedCount + 1 }
      });

      return {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
        },
        serviceId: serviceId,
        originalAmount: basePrice,
        discountAmount: discountAmount,
        finalAmount: basePrice - discountAmount,
      };
    },

    async applyUserVoucher(request: ApplyVoucher): Promise<any> {
      const { voucherCode, basePrice, userId } = request;
      
      // Find voucher by code
      const vouchers = await executeRepositorySelect(
        'select * from vouchers where code = ?',
        [voucherCode.toUpperCase()]
      );
      
      if (vouchers.length === 0) {
        throw new Error('Voucher not found');
      }

      const voucher = vouchers[0];

      // Validate voucher
      if (!isVoucherApplicable(voucher, request, 'USER')) {
        throw new Error('Voucher is not applicable for this user');
      }

      // Calculate discount
      const discountAmount = calculateDiscount(voucher, basePrice, request.currentCalls || 0);

      // Update voucher usage count
      await executeRepositoryAction('update', {
        id: voucher.id,
        data: { usedCount: voucher.usedCount + 1 }
      });

      return {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
        },
        userId: userId,
        originalAmount: basePrice,
        discountAmount: discountAmount,
        finalAmount: basePrice - discountAmount,
      };
    },

    async getVouchers(status?: string, targetType?: string): Promise<any[]> {
      let sql = 'select * from vouchers where 1=1';
      const params: any[] = [];

      if (status) {
        sql += ' and status = ?';
        params.push(status);
      }

      if (targetType) {
        sql += ' and targetType in (?, ?)';
        params.push(targetType, 'BOTH');
      }

      sql += ' order by createdAt desc';

      return await executeRepositorySelect(sql, params);
    },

    async getVoucherByCode(voucherCode: string): Promise<any> {
      const vouchers = await executeRepositorySelect(
        'select * from vouchers where code = ?',
        [voucherCode.toUpperCase()]
      );
      
      if (vouchers.length === 0) {
        throw new Error('Voucher not found');
      }
      
      return vouchers[0];
    },

    async validateServiceVoucher(request: ValidateVoucherRequest): Promise<any> {
      const { voucherCode } = request;
      
      const vouchers = await executeRepositorySelect(
        'select * from vouchers where code = ?',
        [voucherCode.toUpperCase()]
      );
      
      if (vouchers.length === 0) {
        return { isValid: false, errorMessage: 'Voucher not found' };
      }

      const voucher = vouchers[0];
      const isValid = isVoucherApplicable(voucher, request, 'SERVICE');

      return {
        isValid,
        errorMessage: isValid ? undefined : 'Voucher is not applicable for this service',
        voucher: isValid ? {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
          discountValue: voucher.discountValue,
          maxDiscountAmount: voucher.maxDiscountAmount,
        } : undefined
      };
    },

    async validateUserVoucher(request: ValidateVoucherRequest): Promise<any> {
      const { voucherCode } = request;
      
      const vouchers = await executeRepositorySelect(
        'select * from vouchers where code = ?',
        [voucherCode.toUpperCase()]
      );
      
      if (vouchers.length === 0) {
        return { isValid: false, errorMessage: 'Voucher not found' };
      }

      const voucher = vouchers[0];
      const isValid = isVoucherApplicable(voucher, request, 'USER');

      return {
        isValid,
        errorMessage: isValid ? undefined : 'Voucher is not applicable for this user',
        voucher: isValid ? {
          id: voucher.id,
          code: voucher.code,
          name: voucher.name,
          type: voucher.type,
          discountValue: voucher.discountValue,
          maxDiscountAmount: voucher.maxDiscountAmount,
        } : undefined
      };
    },

    async updateVoucherStatus(voucherId: string, status: string): Promise<any> {
      const voucher = await executeRepositoryAction('findById', { id: voucherId });
      if (!voucher) {
        throw new Error('Voucher not found');
      }

      return await executeRepositoryAction('update', {
        id: voucherId,
        data: { 
          status,
          updatedAt: new Date().toISOString()
        }
      });
    },

    async getAvailableServiceVouchers(serviceId?: string, basePrice?: number): Promise<any[]> {
      let sql = `
        select * from vouchers 
        where status = 'ACTIVE' 
        and (usageLimit is null or usedCount < usageLimit)
        and targetType in ('SERVICE', 'BOTH')
      `;
      const params: any[] = [];

      if (serviceId) {
        sql += ` and (applicableServices = '[]' or json_contains(applicableServices, ?))`;
        params.push(`"${serviceId}"`);
      }

      const vouchers = await executeRepositorySelect(sql, params);
      
      // Filter by base price if provided
      if (basePrice !== undefined) {
        return vouchers.filter(voucher => 
          !voucher.minOrderAmount || basePrice >= voucher.minOrderAmount
        );
      }

      return vouchers;
    },

    async getAvailableUserVouchers(userId?: string, userRole?: string, basePrice?: number): Promise<any[]> {
      let sql = `
        select * from vouchers 
        where status = 'ACTIVE' 
        and (usageLimit is null or usedCount < usageLimit)        
        and targetType in ('USER', 'BOTH')
      `;
      const params: any[] = [];

      const vouchers = await executeRepositorySelect(sql, params);
      
      // Filter by user-specific conditions
      return vouchers.filter(voucher => {
        if (voucher.applicableUsers?.length && userId && !voucher.applicableUsers.includes(userId)) {
          return false;
        }

        if (voucher.userRoles?.length && userRole && !voucher.userRoles.includes(userRole)) {
          return false;
        }

        if (basePrice !== undefined && voucher.minOrderAmount && basePrice < voucher.minOrderAmount) {
          return false;
        }

        return true;
      });
    },
  };
}