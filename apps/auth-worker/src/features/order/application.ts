import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createOrderInfrastructureService } from './infrastructure';
import {
  CreateOrder,
  UpdateOrderStatus,
  ApplyVoucherToOrder,
  CalculateOrderRequest,
  Order,
  OrderDetail
} from './domain';

export interface IOrderApplicationService {
  createOrder(identifier: string, request: CreateOrder): Promise<any>;
  getOrders(identifier: string, filters: any): Promise<any[]>;
  getOrderDetail(identifier: string, orderId: string): Promise<any>;
  updateOrderStatus(identifier: string, orderId: string, request: UpdateOrderStatus): Promise<any>;
  applyVoucherToOrder(identifier: string, orderId: string, request: ApplyVoucherToOrder): Promise<any>;
  calculateOrder(identifier: string, request: CalculateOrderRequest): Promise<any>;
  cancelOrder(identifier: string, orderId: string): Promise<any>;
  getAvailableVouchersForOrder(identifier: string, orderId: string): Promise<any[]>;
}

export function createOrderApplicationService(c: Context, bindingName: string): IOrderApplicationService {
  return {
    async createOrder(identifier: string, request: CreateOrder): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      const order = await orderInfra.createOrder(request);
      
      return {
        id: order.id,
        orderCode: order.orderCode,
        targetType: order.targetType,
        customerId: order.customerId,
        userId: order.userId,
        customerName: order.customerName,
        status: order.status,
        subtotalAmount: order.subtotalAmount,
        discountAmount: order.discountAmount,
        finalAmount: order.finalAmount,
        createdAt: order.createdAt,
      };
    },

    async getOrders(identifier: string, filters: any): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      const orders = await orderInfra.getOrders(filters);
      
      return orders.map(order => ({
        id: order.id,
        orderCode: order.orderCode,
        targetType: order.targetType,
        customerName: order.customerName,
        serviceName: order.items?.[0]?.serviceName || 'Service',
        status: order.status,
        subtotalAmount: order.subtotalAmount,
        finalAmount: order.finalAmount,
        itemCount: order.items?.length || 0,
        createdAt: order.createdAt,
      }));
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
      const order = await orderInfra.updateOrderStatus(orderId, request);
      
      return {
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        updatedAt: order.updatedAt,
      };
    },

    async applyVoucherToOrder(identifier: string, orderId: string, request: ApplyVoucherToOrder): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      const order = await orderInfra.applyVoucherToOrder(orderId, request);
      
      return {
        id: order.id,
        orderCode: order.orderCode,
        voucherCode: order.appliedVoucherCode,
        discountAmount: order.discountAmount,
        finalAmount: order.finalAmount,
        updatedAt: order.updatedAt,
      };
    },

    async calculateOrder(identifier: string, request: CalculateOrderRequest): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      return await orderInfra.calculateOrder(request);
    },

    async cancelOrder(identifier: string, orderId: string): Promise<any> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      const order = await orderInfra.cancelOrder(orderId);
      
      return {
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        cancelledAt: order.updatedAt,
      };
    },

    async getAvailableVouchersForOrder(identifier: string, orderId: string): Promise<any[]> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const orderInfra = createOrderInfrastructureService(userDO, c, bindingName);
      return await orderInfra.getAvailableVouchersForOrder(orderId);
    },
  };
}