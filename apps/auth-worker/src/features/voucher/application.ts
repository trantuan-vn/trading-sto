import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createVoucherInfrastructureService } from './infrastructure';
import {
  CreateVoucher,
  ApplyVoucher,
  ValidateVoucherRequest,
  Voucher,
} from './domain';

export interface IVoucherApplicationService {
  createVoucher(identifier: string, request: CreateVoucher): Promise<Voucher>;
  applyServiceVoucher(identifier: string, request: ApplyVoucher): Promise<any>;
  applyUserVoucher(identifier: string, request: ApplyVoucher): Promise<any>;
  getVouchers(identifier: string, status?: string, targetType?: string): Promise<Voucher[]>;
  getVoucherByCode(identifier: string, voucherCode: string): Promise<Voucher>;
  validateServiceVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any>;
  validateUserVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any>;
  updateVoucherStatus(identifier: string, voucherId: string, status: string): Promise<Voucher>;
  // getVoucherUsage(identifier: string, voucherId: string): Promise<any[]>;
  getAvailableServiceVouchers(identifier: string, serviceId?: string, basePrice?: number): Promise<Voucher[]>;
  getAvailableUserVouchers(identifier: string, userId?: string, userRole?: string, basePrice?: number): Promise<Voucher[]>;
}

export function createVoucherApplicationService(c: Context, bindingName: string): IVoucherApplicationService {
  return {
    async createVoucher(identifier: string, request: CreateVoucher): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      const voucher = await voucherInfra.createVoucher(request);
      
      return {
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountValue: voucher.discountValue,
        minOrderAmount: voucher.minOrderAmount,
        maxDiscountAmount: voucher.maxDiscountAmount,
        usageLimit: voucher.usageLimit,
        usedCount: voucher.usedCount,
        targetType: voucher.targetType,
        applicableServices: voucher.applicableServices,
        applicableUsers: voucher.applicableUsers,
        userRoles: voucher.userRoles,
        startDate: voucher.startDate,
        endDate: voucher.endDate,
        status: voucher.status,
        createdAt: voucher.createdAt,
      };
    },

    async applyServiceVoucher(identifier: string, request: ApplyVoucher): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      return await voucherInfra.applyServiceVoucher(request);
    },

    async applyUserVoucher(identifier: string, request: ApplyVoucher): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      return await voucherInfra.applyUserVoucher(request);
    },

    async getVouchers(identifier: string, status?: string, targetType?: string): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      const vouchers = await voucherInfra.getVouchers(status, targetType);
      
      return vouchers.map(voucher => ({
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountValue: voucher.discountValue,
        usedCount: voucher.usedCount,
        usageLimit: voucher.usageLimit,
        targetType: voucher.targetType,
        status: voucher.status,
        startDate: voucher.startDate,
        endDate: voucher.endDate,
      }));
    },

    async getVoucherByCode(identifier: string, voucherCode: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      const voucher = await voucherInfra.getVoucherByCode(voucherCode);
      
      return {
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountValue: voucher.discountValue,
        minOrderAmount: voucher.minOrderAmount,
        maxDiscountAmount: voucher.maxDiscountAmount,
        usageLimit: voucher.usageLimit,
        usedCount: voucher.usedCount,
        targetType: voucher.targetType,
        applicableServices: voucher.applicableServices,
        applicableUsers: voucher.applicableUsers,
        userRoles: voucher.userRoles,
        startDate: voucher.startDate,
        endDate: voucher.endDate,
        status: voucher.status,
      };
    },

    async validateServiceVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      return await voucherInfra.validateServiceVoucher(request);
    },

    async validateUserVoucher(identifier: string, request: ValidateVoucherRequest): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      return await voucherInfra.validateUserVoucher(request);
    },

    async updateVoucherStatus(identifier: string, voucherId: string, status: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      const voucher = await voucherInfra.updateVoucherStatus(voucherId, status);
      
      return {
        id: voucher.id,
        code: voucher.code,
        status: voucher.status,
        updatedAt: voucher.updatedAt,
      };
    },

    // async getVoucherUsage(identifier: string, voucherId: string): Promise<any[]> {
    //   const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
    //   const sysDO = getIdFromName<UserDO>(c, 'system', bindingName);
    //   const voucherInfra = createVoucherInfrastructureService(userDO, sysDO);
    //   return await voucherInfra.getVoucherUsage(voucherId);
    // },

    async getAvailableServiceVouchers(identifier: string, serviceId?: string, basePrice?: number): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      return await voucherInfra.getAvailableServiceVouchers(serviceId, basePrice);
    },

    async getAvailableUserVouchers(identifier: string, userId?: string, userRole?: string, basePrice?: number): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const voucherInfra = createVoucherInfrastructureService(userDO);
      return await voucherInfra.getAvailableUserVouchers(userId, userRole, basePrice);
    },
  };
}