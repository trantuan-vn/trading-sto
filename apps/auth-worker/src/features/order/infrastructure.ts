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
  OrderDiscountSchema
} from './domain';

export function createOrderInfrastructureService(userDO: UserDO, context: any, bindingName: string): IOrderInfrastructureService {

    const orders = userDO.table('orders', OrderSchema, { userScoped: true });
    const orderItems = userDO.table('order_items', OrderItemSchema, { userScoped: true });
    const orderDiscounts = userDO.table('order_discounts', OrderDiscountSchema, { userScoped: true });

    // Helper method duy nhất cho tính toán order
    async function calculateOrderTotal(request: CalculateOrderRequest, priceApp: any, voucherApp: any): Promise<any> {
      let subtotalAmount = 0;
      const pricedItems = [];
      const appliedDiscounts = [];

      // 1. Tính subtotal và áp dụng price policies cho từng service
      for (const item of request.items) {
        const itemTotal = item.basePrice * item.quantity;
        subtotalAmount += itemTotal;

        // Áp dụng price policies cho service dựa trên targetType
        try {
          let priceResult;
          
          if (request.targetType === 'SERVICE') {
            // Tính giá cho service order (customer mua service)
            priceResult = await priceApp.calculateServicePrice('system', {
              basePrice: item.basePrice,
              serviceId: item.serviceId,
              serviceName: item.serviceName,
              currentCalls: item.currentCalls,
              maxCalls: item.maxCalls,
              quantity: item.quantity,
              customerId: request.customerId,
              userId: request.userId,
            });
          } else {
            // Tính giá cho user order (user cá nhân mua service)
            priceResult = await priceApp.calculateUserPrice('system', {
              basePrice: item.basePrice,
              userId: request.userId,
              userRole: request.userRole,
              userGroup: request.userGroup,
              quantity: item.quantity,
            });
          }

          const finalUnitPrice = priceResult.finalPrice;
          pricedItems.push({
            serviceId: item.serviceId,
            originalUnitPrice: item.basePrice,
            finalUnitPrice: finalUnitPrice,
            appliedPolicyId: priceResult.appliedPolicies[0]?.policyId,
            discount: item.basePrice - finalUnitPrice,
          });

          // Ghi log discounts từ price policies
          for (const policy of priceResult.appliedPolicies) {
            appliedDiscounts.push({
              type: 'PRICE_POLICY',
              source: policy.policyName,
              amount: policy.discount * item.quantity,
              description: `${policy.policyName} - ${item.serviceName}`,
            });
          }
        } catch (error) {
          // Nếu không áp dụng được price policy, dùng giá gốc
          pricedItems.push({
            serviceId: item.serviceId,
            originalUnitPrice: item.basePrice,
            finalUnitPrice: item.basePrice,
            discount: 0,
          });
        }
      }

      // 2. Tính lại subtotal sau khi áp dụng price policies
      const subtotalAfterPolicies = pricedItems.reduce((sum, item) => {
        const foundItem = request.items.find((i: any) => i.serviceId === item.serviceId);
        const quantity = foundItem?.quantity ?? 1;
        return sum + item.finalUnitPrice * quantity;
      }, 0);

      // 3. Áp dụng voucher nếu có
      let voucherDiscount = 0;
      if (request.voucherCode) {
        try {
          let voucherResult;
          
          if (request.targetType === 'SERVICE') {
            // Áp dụng voucher service
            voucherResult = await voucherApp.applyServiceVoucher('system', {
              voucherCode: request.voucherCode,
              basePrice: subtotalAfterPolicies,
              serviceId: request.items[0]?.serviceId,
              customerId: request.customerId,
              userId: request.userId,
            });
          } else {
            // Áp dụng voucher user
            voucherResult = await voucherApp.applyUserVoucher('system', {
              voucherCode: request.voucherCode,
              basePrice: subtotalAfterPolicies,
              userId: request.userId,
              userRole: request.userRole,
            });
          }

          voucherDiscount = voucherResult.discountAmount;
          appliedDiscounts.push({
            type: 'VOUCHER',
            source: request.voucherCode,
            amount: voucherDiscount,
            description: `${request.targetType} Voucher: ${request.voucherCode}`,
          });
        } catch (error) {
          console.warn('Failed to apply voucher:', error);
        }
      }

      // 4. Tính tổng final amount
      const totalDiscount = appliedDiscounts.reduce((sum, discount) => sum + discount.amount, 0);
      const finalAmount = subtotalAfterPolicies - voucherDiscount;

      return {
        targetType: request.targetType,
        subtotalAmount: subtotalAfterPolicies,
        totalDiscount: totalDiscount,
        voucherDiscount: voucherDiscount,
        finalAmount: Math.max(0, finalAmount),
        pricedItems: pricedItems,
        appliedDiscounts: appliedDiscounts,
      };
    }

    function generateOrderCode(): string {
      const timestamp = new Date().getTime().toString().slice(-6);
      const random = Math.random().toString(36).substring(2, 5).toUpperCase();
      return `ORDER_${timestamp}${random}`;
    }

    return {
      async createOrder(request: CreateOrder): Promise<any> {
        // 1. Tính toán giá với Price Service và Voucher Service
        const priceApp = createPriceApplicationService(context, bindingName);
        const voucherApp = createVoucherApplicationService(context, bindingName);

        const calculationResult = await calculateOrderTotal(request, priceApp, voucherApp);

        // 2. Tạo order record
        const orderData = OrderSchema.parse({
          orderCode: generateOrderCode(),
          targetType: request.targetType,
          customerId: request.customerId,
          userId: request.userId,
          customerName: request.customerName,
          customerEmail: request.customerEmail,
          customerPhone: request.customerPhone,
          userRole: request.userRole,
          // Thông tin giá
          subtotalAmount: calculationResult.subtotalAmount,
          discountAmount: calculationResult.totalDiscount,
          totalAmount: calculationResult.finalAmount,
          finalAmount: calculationResult.finalAmount,
          // Thông tin áp dụng
          appliedVoucherCode: request.voucherCode,
          appliedVoucherDiscount: calculationResult.voucherDiscount,        
          status: 'PENDING',
          notes: request.notes,
        });

        const orderRecord = await orders.create(orderData);

        // 3. Tạo order items (chỉ có service)
        for (const item of request.items) {
          const pricedItem = calculationResult.pricedItems.find((p: any) => p.serviceId === item.serviceId);
          
          await orderItems.create({
            orderId: orderRecord.id,
            targetType: request.targetType,
            serviceId: item.serviceId,
            serviceName: item.serviceName,
            basePrice: item.basePrice,
            finalUnitPrice: pricedItem?.finalUnitPrice || item.basePrice,
            quantity: item.quantity,
            totalPrice: (pricedItem?.finalUnitPrice || item.basePrice) * item.quantity,
            currentCalls: item.currentCalls,
            maxCalls: item.maxCalls,
            appliedPricingPolicyId: pricedItem?.appliedPolicyId,
          });
        }

        // 4. Ghi log discounts
        for (const discount of calculationResult.appliedDiscounts) {
          await orderDiscounts.create(OrderDiscountSchema.parse({
            orderId: orderRecord.id,
            discountType: discount.type,
            discountSource: discount.source,
            discountAmount: discount.amount,
            description: discount.description,
          }));
        }

        return { 
          ...orderData, 
          id: orderRecord.id, 
          items: request.items,
          discounts: calculationResult.appliedDiscounts 
        };
      },

      async getOrders(filters: any): Promise<any[]> {
        let query = orders.where('1', '==', '1');
        
        if (filters.status) {
          query = query.where('status', '==', filters.status);
        }
        
        if (filters.targetType) {
          query = query.where('targetType', '==', filters.targetType);
        }
        
        if (filters.customerId) {
          query = query.where('customerId', '==', filters.customerId);
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
        const discounts = await orderDiscounts.where('orderId', '==', orderId).get();

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

        const updateData = {
          ...order,
          status: request.status,
        };

        if (request.notes) {
          updateData['internalNotes'] = request.notes;
        }

        await orders.update(orderId, updateData);
        return { ...order, ...updateData, id: orderId };
      },

      async applyVoucherToOrder(orderId: string, request: ApplyVoucherToOrder): Promise<any> {
        const order = await orders.findById(orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        const voucherApp = createVoucherApplicationService(context, bindingName);
        const items = await orderItems.where('orderId', '==', orderId).get();
        
        let voucherResult;
        if (order.targetType === 'SERVICE') {
          // Áp dụng voucher service
          const serviceId = items[0]?.serviceId;
          voucherResult = await voucherApp.applyServiceVoucher('system', {
            voucherCode: request.voucherCode,
            basePrice: order.subtotalAmount,
            serviceId: serviceId,
            customerId: order.customerId,
            userId: order.userId,
          });
        } else {
          // Áp dụng voucher user
          voucherResult = await voucherApp.applyUserVoucher('system', {
            voucherCode: request.voucherCode,
            basePrice: order.subtotalAmount,
            userId: order.userId,
            userRole: order.userRole,
          });
        }

        // Update order với voucher discount
        const newDiscountAmount = order.discountAmount + voucherResult.discountAmount;
        const newFinalAmount = order.totalAmount - voucherResult.discountAmount;

        const updateData = {
          appliedVoucherCode: request.voucherCode,
          appliedVoucherDiscount: voucherResult.discountAmount,
          discountAmount: newDiscountAmount,
          finalAmount: newFinalAmount,
        };

        await orders.update(orderId, updateData);

        // Ghi log discount
        await orderDiscounts.create(OrderDiscountSchema.parse({
          orderId: orderId,
          discountType: 'VOUCHER',
          discountSource: request.voucherCode,
          discountAmount: voucherResult.discountAmount,
          description: `${order.targetType} Voucher: ${request.voucherCode}`,
        }));

        return { ...order, ...updateData, id: orderId };
      },

      async calculateOrder(request: CalculateOrderRequest): Promise<any> {
        const priceApp = createPriceApplicationService(context, bindingName);
        const voucherApp = createVoucherApplicationService(context, bindingName);
        
        return await calculateOrderTotal(request, priceApp, voucherApp);
      },

      async cancelOrder(orderId: string): Promise<any> {
        const order = await orders.findById(orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
          throw new Error(`Cannot cancel order with status: ${order.status}`);
        }

        const updateData = OrderSchema.parse({
          ...order,
          status: 'CANCELLED',
        });

        await orders.update(orderId, updateData);
        return { ...updateData, id: orderId };
      },

      async getAvailableVouchersForOrder(orderId: string): Promise<any[]> {
        const order = await orders.findById(orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        const voucherApp = createVoucherApplicationService(context, bindingName);
        const items = await orderItems.where('orderId', '==', orderId).get();

        if (order.targetType === 'SERVICE') {
          const serviceId = items[0]?.serviceId;
          return await voucherApp.getAvailableServiceVouchers('system', serviceId, order.subtotalAmount);
        } else {
          return await voucherApp.getAvailableUserVouchers('system', order.userId, order.userRole, order.subtotalAmount);
        }
      },
    };
}