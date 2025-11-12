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
      return await priceInfra.createPricePolicy(request);      
    },

    async updatePricePolicy(identifier: string, policyId: string, request: UpdatePricePolicy): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      return await priceInfra.updatePricePolicy(policyId, request);
    },

    async getPricePolicies(identifier: string, status?: string): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      return await priceInfra.getPricePolicies(status);      
    },

    async getPricePolicy(identifier: string, policyId: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const priceInfra = createPriceInfrastructureService(userDO);
      return await priceInfra.getPricePolicy(policyId);      
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