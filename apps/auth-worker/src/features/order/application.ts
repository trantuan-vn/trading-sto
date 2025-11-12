import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createOrderInfrastructureService } from './infrastructure';
import {
  CreateOrder,
  UpdateOrderStatus,
} from './domain';

export interface IOrderApplicationService {
  createOrder(user: any, request: CreateOrder): Promise<any>;
  getOrders(identifier: string, filters: any): Promise<any[]>;
  getOrderDetail(identifier: string, orderId: string): Promise<any>;
  updateOrderStatus(identifier: string, orderId: string, request: UpdateOrderStatus): Promise<any>;
  cancelOrder(identifier: string, orderId: string): Promise<any>;
}

export function createOrderApplicationService(c: Context, bindingName: string): IOrderApplicationService {
  return {
    async createOrder(user: any, request: CreateOrder): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, user.identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      return await orderInfra.createOrder(user.id, user.role, request);      
    },

    async getOrders(identifier: string, filters: any): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      return await orderInfra.getOrders(filters);      
    },

    async getOrderDetail(identifier: string, orderId: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      const order = await orderInfra.getOrderDetail(orderId);
      
      return order;
    },

    async updateOrderStatus(identifier: string, orderId: string, request: UpdateOrderStatus): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      return await orderInfra.updateOrderStatus(orderId, request);      
    },

    async cancelOrder(identifier: string, orderId: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      return await orderInfra.cancelOrder(orderId);
    }
  };
}