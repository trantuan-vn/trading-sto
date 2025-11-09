import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createPriceInfrastructureService } from './infrastructure';
import {
  CreatePricePolicy,
  UpdatePricePolicy,
  ServicePriceCalculationRequest,
  UserPriceCalculationRequest,
  PricePolicy,
} from './domain';

export interface IPriceApplicationService {
  createPricePolicy(identifier: string, request: CreatePricePolicy): Promise<PricePolicy>;
  updatePricePolicy(identifier: string, policyId: string, request: UpdatePricePolicy): Promise<PricePolicy>;
  getPricePolicies(identifier: string, status?: string): Promise<PricePolicy[]>;
  getPricePolicy(identifier: string, policyId: string): Promise<PricePolicy>;
  deletePricePolicy(identifier: string, policyId: string): Promise<void>;
  calculateServicePrice(identifier: string, request: ServicePriceCalculationRequest): Promise<any>;
  calculateUserPrice(identifier: string, request: UserPriceCalculationRequest): Promise<any>;
  updatePolicyStatus(identifier: string, policyId: string, status: string): Promise<PricePolicy>;
}

export function createPriceApplicationService(c: Context, bindingName: string): IPriceApplicationService {
  return {
    async createPricePolicy(identifier: string, request: CreatePricePolicy): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      const policy = await priceInfra.createPricePolicy(request);
      
      return {
        id: policy.id,
        name: policy.name,
        type: policy.type,
        value: policy.value,
        applicableTo: policy.applicableTo,
        targetType: policy.targetType,
        targetIds: policy.targetIds,
        conditions: policy.conditions,
        priority: policy.priority,
        status: policy.status,
        startDate: policy.startDate,
        endDate: policy.endDate,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      };
    },

    async updatePricePolicy(identifier: string, policyId: string, request: UpdatePricePolicy): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      const policy = await priceInfra.updatePricePolicy(policyId, request);
      
      return {
        id: policy.id,
        name: policy.name,
        type: policy.type,
        value: policy.value,
        applicableTo: policy.applicableTo,
        targetType: policy.targetType,
        targetIds: policy.targetIds,
        conditions: policy.conditions,
        priority: policy.priority,
        status: policy.status,
        startDate: policy.startDate,
        endDate: policy.endDate,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      };
    },

    async getPricePolicies(identifier: string, status?: string): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      const policies = await priceInfra.getPricePolicies(status);
      
      return policies.map(policy => ({
        id: policy.id,
        name: policy.name,
        type: policy.type,
        value: policy.value,
        applicableTo: policy.applicableTo,
        targetType: policy.targetType,
        priority: policy.priority,
        status: policy.status,
        startDate: policy.startDate,
        endDate: policy.endDate,
        createdAt: policy.createdAt,
      }));
    },

    async getPricePolicy(identifier: string, policyId: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      const policy = await priceInfra.getPricePolicy(policyId);
      
      return {
        id: policy.id,
        name: policy.name,
        type: policy.type,
        value: policy.value,
        applicableTo: policy.applicableTo,
        targetType: policy.targetType,
        targetIds: policy.targetIds,
        conditions: policy.conditions,
        priority: policy.priority,
        status: policy.status,
        startDate: policy.startDate,
        endDate: policy.endDate,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      };
    },

    async deletePricePolicy(identifier: string, policyId: string): Promise<void> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      await priceInfra.deletePricePolicy(policyId);
    },

    async calculateServicePrice(identifier: string, request: ServicePriceCalculationRequest): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      return await priceInfra.calculateServicePrice(request);
    },

    async calculateUserPrice(identifier: string, request: UserPriceCalculationRequest): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      return await priceInfra.calculateUserPrice(request);
    },

    async updatePolicyStatus(identifier: string, policyId: string, status: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      const policy = await priceInfra.updatePolicyStatus(policyId, status);
      
      return {
        id: policy.id,
        name: policy.name,
        status: policy.status,
        updatedAt: policy.updatedAt,
      };
    },
  };
}