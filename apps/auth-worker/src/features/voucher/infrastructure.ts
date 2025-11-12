import { UserDO } from '../ws/infrastructure/UserDO';
import {
  CreateVoucher,
  ApplyVoucher,
  ValidateVoucherRequest,
  IVoucherInfrastructureService,
  VoucherSchema,
//   VoucherUsageSchema
} from './domain';

export function createVoucherInfrastructureService(userDO: UserDO): IVoucherInfrastructureService {

    const vouchers = userDO.table('vouchers', VoucherSchema, { userScoped: true });
    // const voucherUsages = userDO.table('voucher_usages', VoucherUsageSchema, { userScoped: true });
    // Helper methods
    async function validateServiceVoucherInternal(voucher: any, orderAmount: number, currentCalls: number, serviceId?: string): Promise<any> {
        const now = new Date();
        const startDate = new Date(voucher.startDate);
        const endDate = new Date(voucher.endDate);

        // Check target type
        if (voucher.targetType !== 'SERVICE' && voucher.targetType !== 'BOTH') {
            return { isValid: false, errorMessage: 'Voucher is not applicable for services' };
        }

        // Check status
        if (voucher.status !== 'ACTIVE') {
            return { isValid: false, errorMessage: 'Voucher is not active' };
        }

        // Check date validity
        if (now < startDate) {
            return { isValid: false, errorMessage: 'Voucher is not yet active' };
        }

        if (now > endDate) {
            return { isValid: false, errorMessage: 'Voucher has expired' };
        }

        // Check usage limit
        if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit) {
            return { isValid: false, errorMessage: 'Voucher usage limit reached' };
        }

        // Check minimum order amount
        if (voucher.minOrderAmount && orderAmount < voucher.minOrderAmount) {
            return { 
                isValid: false, 
                errorMessage: `Minimum order amount is ${voucher.minOrderAmount.toLocaleString()}` 
            };
        }

        // Check service-specific vouchers
        if (voucher.applicableServices && voucher.applicableServices.length > 0 && serviceId) {
            if (!voucher.applicableServices.includes(serviceId)) {
                return { isValid: false, errorMessage: 'Voucher is not applicable for this service' };
            }
        }
        // Kiểm tra điều kiện usage-based
        if (voucher.conditions && voucher.type === 'USAGE_BASED') {
            const { minUsage, maxCalls } = voucher.conditions;
            
            // Kiểm tra minUsage (số lượng sử dụng tối thiểu)
            if (minUsage !== undefined && currentCalls < minUsage) {
                return { isValid: false, errorMessage: `Minimum usage is ${minUsage}` };
            }
            
            // Kiểm tra maxCalls (số lượng calls tối đa để được giảm giá)
            if (maxCalls !== undefined && currentCalls > maxCalls) {
                return { isValid: false, errorMessage: `Maximum calls is ${maxCalls}` };
            }
        }        

        return { 
            isValid: true,
            voucher: {
                id: voucher.id,
                code: voucher.code,
                name: voucher.name,
                type: voucher.type,
                discountValue: voucher.discountValue,
                maxDiscountAmount: voucher.maxDiscountAmount,
            }
        };
    }

    async function validateUserVoucherInternal(voucher: any, orderAmount: number, currentCalls: number, userId?: string, userRole?: string): Promise<any> {
        const now = new Date();
        const startDate = new Date(voucher.startDate);
        const endDate = new Date(voucher.endDate);

        // Check target type
        if (voucher.targetType !== 'USER' && voucher.targetType !== 'BOTH') {
            return { isValid: false, errorMessage: 'Voucher is not applicable for users' };
        }

        // Check status
        if (voucher.status !== 'ACTIVE') {
            return { isValid: false, errorMessage: 'Voucher is not active' };
        }

        // Check date validity
        if (now < startDate) {
            return { isValid: false, errorMessage: 'Voucher is not yet active' };
        }

        if (now > endDate) {
            return { isValid: false, errorMessage: 'Voucher has expired' };
        }

        // Check usage limit
        if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit) {
            return { isValid: false, errorMessage: 'Voucher usage limit reached' };
        }

        // Check minimum order amount
        if (voucher.minOrderAmount && orderAmount < voucher.minOrderAmount) {
            return { 
                isValid: false, 
                errorMessage: `Minimum order amount is ${voucher.minOrderAmount.toLocaleString()}` 
            };
        }

        // Check user-specific vouchers
        if (voucher.applicableUsers && voucher.applicableUsers.length > 0 && userId) {
            if (!voucher.applicableUsers.includes(userId)) {
                return { isValid: false, errorMessage: 'Voucher is not applicable for this user' };
            }
        }

        // Check user role restrictions
        if (voucher.userRoles && voucher.userRoles.length > 0 && userRole) {
            if (!voucher.userRoles.includes(userRole)) {
                return { isValid: false, errorMessage: 'Voucher is not applicable for your user role' };
            }
        }

        // Kiểm tra điều kiện usage-based
        if (voucher.conditions && voucher.type === 'USAGE_BASED') {
            const { minUsage, maxCalls } = voucher.conditions;
            
            // Kiểm tra minUsage (số lượng sử dụng tối thiểu)
            if (minUsage !== undefined && currentCalls < minUsage) {
                return { isValid: false, errorMessage: `Minimum usage is ${minUsage}` };
            }
            
            // Kiểm tra maxCalls (số lượng calls tối đa để được giảm giá)
            if (maxCalls !== undefined && currentCalls > maxCalls) {
                return { isValid: false, errorMessage: `Maximum calls is ${maxCalls}` };
            }
        }        


        return { 
            isValid: true,
            voucher: {
                id: voucher.id,
                code: voucher.code,
                name: voucher.name,
                type: voucher.type,
                discountValue: voucher.discountValue,
                maxDiscountAmount: voucher.maxDiscountAmount,
            }
        };
    }

    function calculateDiscount(voucher: any, basePrice: number, currentCalls: number): number {
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
                // Discount based on service usage
                discount = calculateUsageBasedDiscount(voucher, basePrice, currentCalls);
                break;

            case 'TIERED':
                discount = calculateTieredDiscount(voucher, basePrice);
                break;
        }

        return Math.min(discount, basePrice); // Cannot discount more than base price
    }

    function calculateUsageBasedDiscount(voucher: any, basePrice: number, currentCalls: number): number {
        // Với USAGE_BASED, có thể tính discount dựa trên currentCalls
        if (voucher.conditions?.minUsage && voucher.conditions?.maxCalls) {
            const { minUsage, maxCalls } = voucher.conditions;
            
            // Ví dụ: discount tăng theo số lượng usage
            if (currentCalls >= minUsage && currentCalls <= maxCalls) {
            const usageRange = maxCalls - minUsage;
            const currentPosition = currentCalls - minUsage;
            const discountMultiplier = currentPosition / usageRange;
            
            // Discount tăng dần từ 0% đến discountValue%
            return (basePrice * (voucher.discountValue * discountMultiplier)) / 100;
            }
        }
        
        // Fallback: trả về discountValue cố định
        return voucher.discountValue;
    }

    function calculateTieredDiscount(voucher: any, basePrice: number): number {
        const tiers = voucher.conditions?.tiers || [];
        for (const tier of tiers.reverse()) {
            if (basePrice >= tier.minAmount) {
                if (tier.type === 'PERCENTAGE') {
                    return basePrice * (tier.value / 100);
                } else {
                    return tier.value;
                }
            }
        }
        return 0;
    }

    return {
        async createVoucher(request: CreateVoucher): Promise<any> {
            const voucherData = VoucherSchema.parse({
                code: request.code.toUpperCase(),
                name: request.name,
                type: request.type,
                discountValue: request.discountValue,
                minOrderAmount: request.minOrderAmount,
                maxDiscountAmount: request.maxDiscountAmount,
                usageLimit: request.usageLimit,
                usedCount: 0,
                targetType: request.targetType,
                applicableServices: request.applicableServices || [],
                applicableUsers: request.applicableUsers || [],
                userRoles: request.userRoles || [],
                startDate: request.startDate,
                endDate: request.endDate,
                status: 'ACTIVE',
                conditions: request.conditions || {},
            });

            // Check if code already exists
            const existingVoucher = await vouchers.where('code', '==', voucherData.code).first();
            if (existingVoucher) {
                throw new Error('Voucher code already exists');
            }

            const createdRecord = await vouchers.create(voucherData);
            return { ...voucherData, id: createdRecord.id };
        },

        async applyServiceVoucher(request: ApplyVoucher): Promise<any> {
            const { voucherCode, basePrice, orderAmount, serviceId } = request;
            
            // 1. Find voucher by code
            const voucher = await vouchers.where('code', '==', voucherCode.toUpperCase()).first();
            if (!voucher) {
                throw new Error('Voucher not found');
            }

            // 2. Validate voucher for service
            const validation = await validateServiceVoucherInternal(voucher, orderAmount, request.currentCalls || 0, serviceId);
            if (!validation.isValid) {
                throw new Error(validation.errorMessage || 'Voucher is not applicable for this service');
            }

            // 3. Calculate discount
            const discountAmount = calculateDiscount(voucher, basePrice, request.currentCalls || 0);

            // // 4. Record usage
            // await voucherUsages.create({
            //     voucherId: voucher.id,
            //     voucherCode: voucher.code,
            //     targetType: 'SERVICE',
            //     serviceId: serviceId,
            //     userId: userId,
            //     customerId: customerId,
            //     basePrice: basePrice,
            //     discountAmount: discountAmount,
            //     finalPrice: basePrice - discountAmount,
            //     appliedAt: new Date().toISOString(),
            // });

            // 5. Update voucher usage count
            await vouchers.update(voucher.id, {
                usedCount: voucher.usedCount + 1,
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
            const { voucherCode, basePrice, orderAmount, userId, userRole } = request;
            
            // 1. Find voucher by code
            const voucher = await vouchers.where('code', '==', voucherCode.toUpperCase()).first();
            if (!voucher) {
                throw new Error('Voucher not found');
            }

            // 2. Validate voucher for user
            const validation = await validateUserVoucherInternal(voucher, orderAmount, request.currentCalls || 0, userId, userRole);
            if (!validation.isValid) {
                throw new Error(validation.errorMessage || 'Voucher is not applicable for this user');
            }

            // 3. Calculate discount
            const discountAmount = calculateDiscount(voucher, basePrice, request.currentCalls || 0);

            // // 4. Record usage
            // await voucherUsages.create({
            //     voucherId: voucher.id,
            //     voucherCode: voucher.code,
            //     targetType: 'USER',
            //     userId: userId,
            //     userRole: userRole,
            //     customerId: customerId,
            //     basePrice: basePrice,
            //     discountAmount: discountAmount,
            //     finalPrice: basePrice - discountAmount,
            //     appliedAt: new Date().toISOString(),
            // });

            // 5. Update voucher usage count
            await vouchers.update(voucher.id, {
                usedCount: voucher.usedCount + 1,
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
            return await vouchers.where('status', '==', status ? status : 'status')
              .where('targetType', '==', targetType ? targetType : 'targetType' )
              .orderBy('createdAt', 'desc').get();
        },

        async getVoucherByCode(voucherCode: string): Promise<any> {
            const voucher = await vouchers.where('code', '==', voucherCode.toUpperCase()).first();
            if (!voucher) {
                throw new Error('Voucher not found');
            }
            return voucher;
        },

        async validateServiceVoucher(request: ValidateVoucherRequest): Promise<any> {
            const { voucherCode, orderAmount, currentCalls, serviceId } = request;
            
            const voucher = await vouchers.where('code', '==', voucherCode.toUpperCase()).first();
            if (!voucher) {
                return {
                    isValid: false,
                    errorMessage: 'Voucher not found'
                };
            }

            return await validateServiceVoucherInternal(voucher, orderAmount, currentCalls || 0, serviceId);
        },

        async validateUserVoucher(request: ValidateVoucherRequest): Promise<any> {
            const { voucherCode, orderAmount, currentCalls, userId, userRole } = request;
            
            const voucher = await vouchers.where('code', '==', voucherCode.toUpperCase()).first();
            if (!voucher) {
                return {
                    isValid: false,
                    errorMessage: 'Voucher not found'
                };
            }

            return await validateUserVoucherInternal(voucher, orderAmount, currentCalls || 0, userId, userRole);
        },

        async updateVoucherStatus(voucherId: string, status: string): Promise<any> {
            const voucher = await vouchers.findById(voucherId);
            if (!voucher) {
                throw new Error('Voucher not found');
            }

            await vouchers.update(voucherId, { status: status as "ACTIVE" | "INACTIVE" | "EXPIRED" });

            return { ...voucher, status, id: voucherId };
        },

        // async getVoucherUsage(voucherId: string): Promise<any[]> {
        //     return await voucherUsages
        //         .where('voucherId', '==', voucherId)
        //         .orderBy('appliedAt', 'desc')
        //         .get();
        // },

        async getAvailableServiceVouchers(serviceId?: string, basePrice?: number): Promise<any[]> {
            const now = new Date().toISOString();
            let query = vouchers
                .where('status', '==', 'ACTIVE')
                .where('startDate', '<=', now)
                .where('endDate', '>=', now)
                .where('targetType', 'in', ['SERVICE', 'BOTH']);

            if (serviceId) {
              // Get vouchers that are either applicable to all services or specifically to this service
              query.or([
                { path: 'applicableServices', operator: 'includes', value: serviceId },
                { path: 'applicableServices', operator: '==', value: [] }
              ]);            
            }

            const availableVouchers = await query.get();
            
            // Filter by base price if provided
            if (basePrice !== undefined) {
                return availableVouchers.filter(voucher => 
                    !voucher.minOrderAmount || basePrice >= voucher.minOrderAmount
                );
            }

            return availableVouchers;
        },

        async getAvailableUserVouchers(userId?: string, userRole?: string, basePrice?: number): Promise<any[]> {
            const now = new Date().toISOString();
            let query = vouchers
                .where('status', '==', 'ACTIVE')
                .where('startDate', '<=', now)
                .where('endDate', '>=', now)
                .where('targetType', 'in', ['USER', 'BOTH']);

            const availableVouchers = await query.get();
            
            // Filter by user-specific conditions
            return availableVouchers.filter(voucher => {
                // Check user-specific restrictions
                if (voucher.applicableUsers && voucher.applicableUsers.length > 0 && userId) {
                    if (!voucher.applicableUsers.includes(userId)) {
                        return false;
                    }
                }

                // Check user role restrictions
                if (voucher.userRoles && voucher.userRoles.length > 0 && userRole) {
                    if (!voucher.userRoles.includes(userRole as "member" | "admin")) {
                        return false;
                    }
                }

                // Check base price
                if (basePrice !== undefined && voucher.minOrderAmount) {
                    if (basePrice < voucher.minOrderAmount) {
                        return false;
                    }
                }

                return true;
            });
        },
    };
}