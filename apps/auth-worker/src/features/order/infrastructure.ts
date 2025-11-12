import { UserDO } from '../ws/infrastructure/UserDO';
import { createPriceApplicationService } from '../policy/application';
import { createVoucherApplicationService } from '../voucher/application';
import {
  CreateOrder,
  UpdateOrderStatus,
  ApplyVoucherToOrder,
  CalculateOrderRequest,
  IOrderInfrastructureService,
  OrderSchema,
  OrderItemSchema,
  OrderItemDiscountSchema
} from './domain';

import { ServiceSchema } from '../service/domain';
import { UserSchema } from '../auth/domain';

export function createOrderInfrastructureService(userDO: UserDO, context: any, bindingName: string): IOrderInfrastructureService {

    const orders = userDO.table('orders', OrderSchema, { userScoped: true });
    const orderItems = userDO.table('order_items', OrderItemSchema, { userScoped: true });
    const orderDiscounts = userDO.table('order_discounts', OrderItemDiscountSchema, { userScoped: true });

    const services = userDO.table('services', ServiceSchema, { userScoped: true });

    // Helper method duy nhất cho tính toán order
    async function calculateOrderTotal(userId: string, userRole: string, request: CalculateOrderRequest, priceApp: any, voucherApp: any): Promise<any[]> {
      const results = [];
      const orderAmount = request.items.reduce((acc, item) => acc + item.basePrice * item.quantity, 0);      
      
      for (const item of request.items) {
        const service = await services
          .where('id','==', item.serviceId)
          .where('isActive', '==', 'true')
          .where('expiresAt', '>=', new Date().toISOString())
          .first();
        
        if (!service) {
          throw new Error('Service not found');
        }

        const servicePriceResult = await priceApp.calculateServicePrice('system', {
          serviceId: service.id,
          basePrice: item.basePrice,
          quantity: item.quantity,
          currency: request.currency,
          maxCalls: service.maxCalls,
          currentCalls: service.currentCalls,
          serviceName: service.name
        });

        const userPriceResult = await priceApp.calculateUserPrice('system', {
          basePrice: item.basePrice,
          quantity: item.quantity,
          currency: request.currency,
          userId: userId,
          userRole: userRole
        });

        const serviceVoucherResult = await voucherApp.applyServiceVoucher('system', {
          voucherCode: request.voucherCode,
          basePrice: item.basePrice,
          orderAmount: orderAmount,
          serviceId: service.id,
          currentCalls: service.currentCalls,
          userId: userId,
          userRole: userRole
        });

        const userVoucherResult = await voucherApp.applyUserVoucher('system', {
          voucherCode: request.voucherCode,
          basePrice: item.basePrice,
          orderAmount: orderAmount,
          serviceId: service.id,
          currentCalls: service.currentCalls,
          userId: userId,
          userRole: userRole
        });

        // Tạo object chứa các discount lớn hơn 0
        const discounts: {
          servicePriceDiscount?: {
            amount: number;
            type: string;
            appliedPolicies: any[];
          };
          userPriceDiscount?: {
            amount: number;
            type: string;
            appliedPolicies: any[];
          };
          serviceVoucherDiscount?: {
            amount: number;
            type: string;
            voucher: any;
          };
          userVoucherDiscount?: {
            amount: number;
            type: string;
            voucher: any;
          };
        } = {};
        
        if (servicePriceResult.totalDiscount > 0) {
          discounts.servicePriceDiscount = {
            amount: servicePriceResult.totalDiscount,
            type: 'service_price',
            appliedPolicies: servicePriceResult.appliedPolicies
          };
        }
        
        if (userPriceResult.totalDiscount > 0) {
          discounts.userPriceDiscount = {
            amount: userPriceResult.totalDiscount,
            type: 'user_price',
            appliedPolicies: userPriceResult.appliedPolicies
          };
        }
        
        if (serviceVoucherResult.discountAmount > 0) {
          discounts.serviceVoucherDiscount = {
            amount: serviceVoucherResult.discountAmount,
            type: 'service_voucher',
            voucher: serviceVoucherResult.voucher
          };
        }
        
        if (userVoucherResult.discountAmount > 0) {
          discounts.userVoucherDiscount = {
            amount: userVoucherResult.discountAmount,
            type: 'user_voucher',
            voucher: userVoucherResult.voucher
          };
        }

        results.push({
          serviceId: item.serviceId,
          basePrice: item.basePrice,
          quantity: item.quantity,
          servicePrice: {
            finalPrice: servicePriceResult.finalPrice,
            totalDiscount: servicePriceResult.totalDiscount
          },
          userPrice: {
            finalPrice: userPriceResult.finalPrice,
            totalDiscount: userPriceResult.totalDiscount
          },
          serviceVoucher: {
            finalAmount: serviceVoucherResult.finalAmount,
            discountAmount: serviceVoucherResult.discountAmount
          },
          userVoucher: {
            finalAmount: userVoucherResult.finalAmount,
            discountAmount: userVoucherResult.discountAmount
          },
          discounts: Object.keys(discounts).length > 0 ? discounts : undefined
        });
      }      

      return results;
    }

    function generateOrderCode(): string {
      const timestamp = new Date().getTime().toString().slice(-6);
      const random = Math.random().toString(36).substring(2, 5).toUpperCase();
      return `ORDER_${timestamp}${random}`;
    }

    return {
      async createOrder(userId: string, userRole: string, request: CreateOrder): Promise<any> {
        // 1. Tính toán giá với Price Service và Voucher Service
        const priceApp = createPriceApplicationService(context, bindingName);
        const voucherApp = createVoucherApplicationService(context, bindingName);

        const calculationResult = await calculateOrderTotal(userId, userRole, request, priceApp, voucherApp);

        // 2. Tạo order record
        const subtotalAmount = calculationResult.reduce((total: number, item: any) => {
          return total + item.basePrice * item.quantity;
        }, 0);
        const discountAmount = calculationResult.reduce((total: number, item: any) => {
          return total + (item.servicePrice.discountAmount + item.userPrice.discountAmount 
                            + item.serviceVoucher.discountAmount + item.userVoucher.discountAmount);
        }, 0);  
        const finalAmount = calculationResult.reduce((total: number, item: any) => {
          return total + (item.basePrice - (item.servicePrice.discountAmount + item.userPrice.discountAmount 
                            + item.serviceVoucher.discountAmount + item.userVoucher.discountAmount) ) * item.quantity;
        }, 0);         

        const orderData = OrderSchema.parse({
          orderCode: generateOrderCode(),
          subtotalAmount: subtotalAmount,
          discountAmount: discountAmount, 
          finalAmount: finalAmount,
          // Thông tin áp dụng
          currency: request.currency,
          appliedVoucherCode: request.voucherCode,
          status: 'PENDING',
          notes: request.notes,
        });

        const orderRecord = await orders.create(orderData);

        // 3. Tạo order items (chỉ có service)
        for (const item of calculationResult) {
          
          const orderItem= await orderItems.create({
            serviceId: item.serviceId,
            basePrice: item.basePrice,
            quantity: item.quantity,
            finalAmount: item.basePrice - (item.servicePrice.discountAmount + item.userPrice.discountAmount 
                            + item.serviceVoucher.discountAmount + item.userVoucher.discountAmount),
            discountAmount: (item.servicePrice.discountAmount + item.userPrice.discountAmount 
                            + item.serviceVoucher.discountAmount + item.userVoucher.discountAmount),
            orderId: orderRecord.id       
          });
          // 4. Ghi log discounts
          if (item.servicePrice.discountAmount>0) {
              await orderDiscounts.create(OrderItemDiscountSchema.parse({
                orderItemId: orderItem.id,
                discountType: item.discounts.servicePriceDiscount.type,
                discountAmount: item.discounts.servicePriceDiscount.amount,
                appliedPolicies: item.discounts.servicePriceDiscount.appliedPolicies
              }));            
          }

          if (item.userPrice.discountAmount>0) {
            await orderDiscounts.create(OrderItemDiscountSchema.parse({
              orderItemId: orderItem.id,
              discountType: item.discounts.userPriceDiscount.type,
              discountAmount: item.discounts.userPriceDiscount.amount,
              appliedPolicies: item.discounts.userPriceDiscount.appliedPolicies
            }));            
          }

          if (item.serviceVoucher.discountAmount>0) {
            await orderDiscounts.create(OrderItemDiscountSchema.parse({
              orderItemId: orderItem.id,
              discountType: item.discounts.serviceVoucherDiscount.type,
              discountAmount: item.discounts.serviceVoucherDiscount.amount,
              appliedVoucherCode: item.discounts.serviceVoucherDiscount.voucher
            }));            
          }

          if (item.userVoucher.discountAmount>0) {
            await orderDiscounts.create(OrderItemDiscountSchema.parse({
              orderItemId: orderItem.id,
              discountType: item.discounts.userVoucherDiscount.type,
              discountAmount: item.discounts.userVoucherDiscount.amount,
              appliedVoucherCode: item.discounts.userVoucherDiscount.voucher
            }));            
          }
        }

        return { 
          id: orderRecord.id, 
          items: calculationResult
        };
      },

      async getOrders(filters: any): Promise<any[]> {
        let query = orders.where('1', '==', '1');
        
        if (filters.status) {
          query = query.where('status', '==', filters.status);
        }
    
        const result = await query
          .orderBy('createdAt', 'desc')
          .limit(filters.limit)
          .offset((filters.page - 1) * filters.limit)
          .get();

        // Lấy items cho mỗi order
        const ordersWithItems = await Promise.all(
          result.map(async (order) => {
            const items = await orderItems.where('orderId', '==', order.id).get();
            return { ...order, items };
          })
        );

        return ordersWithItems;
      },

      async getOrderDetail(orderId: string): Promise<any> {
        const order = await orders.findById(orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        const items = await orderItems.where('orderId', '==', orderId).get();
        const discounts = await orderDiscounts.where('orderItemId', 'in', items.map((item: any) => item.id)).get();

        return {
          ...order,
          items,
          discounts,
        };
      },

      async updateOrderStatus(orderId: string, request: UpdateOrderStatus): Promise<any> {
        const order = await orders.findById(orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        let updateData;

        if (request.notes) {
          updateData = {
            status: request.status,
            notes: request.notes
          };
        }
        else {
          updateData = {
            status: request.status
          };
        }
      
        await orders.update(orderId, updateData);
        return { ...order, ...updateData, id: orderId };
      },

      async cancelOrder(orderId: string): Promise<any> {
        const order = await orders.findById(orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
          throw new Error(`Cannot cancel order with status: ${order.status}`);
        }

        const updateData = {
          status: 'CANCELLED' as "PENDING" | "CONFIRMED" | "PROCESSING" | "COMPLETED" | "CANCELLED"
        };

        await orders.update(orderId, updateData);
        return { ...order , ...updateData, id: orderId };
      }

    };
}