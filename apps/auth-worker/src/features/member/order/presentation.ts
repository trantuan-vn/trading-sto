import { Hono } from 'hono';
import { createOrderApplicationService } from './application';
import { CreateOrderSchema, UpdateOrderStatusSchema, ApplyVoucherToOrderSchema, CalculateOrderRequestSchema } from './domain';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';

export function createOrderRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Tạo đơn hàng mới (tích hợp price + voucher)
  app.post('/orders', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const request = CreateOrderSchema.parse(body);
      const orderApp = createOrderApplicationService(c, bindingName);
      const result = await orderApp.createOrder(user, request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, 'Failed to create order');
      return c.json(errorResponse, status);
    }
  });

  // Lấy danh sách đơn hàng
  app.get('/orders', async (c) => {
    try {
      const user = requireAuth(c);
      const status = c.req.query('status');
      const targetType = c.req.query('targetType') as 'SERVICE' | 'USER' | undefined;
      const page = parseInt(c.req.query('page') || '1');
      const limit = parseInt(c.req.query('limit') || '20');
      const orderApp = createOrderApplicationService(c, bindingName);
      const result = await orderApp.getOrders(user.identifier, { status, targetType, page, limit });
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, 'Failed to get orders');
      return c.json(errorResponse, status);
    }
  });

  // Lấy chi tiết đơn hàng
  app.get('/orders/:orderId', async (c) => {
    try {
      const user = requireAuth(c);
      const orderId = c.req.param('orderId');
      const orderApp = createOrderApplicationService(c, bindingName);
      const result = await orderApp.getOrderDetail(user.identifier, orderId);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, 'Failed to get order detail');
      return c.json(errorResponse, status);
    }
  });

  // Cập nhật trạng thái đơn hàng
  app.patch('/orders/:orderId/status', async (c) => {
    try {
      const user = requireAuth(c);
      const orderId = c.req.param('orderId');
      const body = await c.req.json();
      const request = UpdateOrderStatusSchema.parse(body);
      const orderApp = createOrderApplicationService(c, bindingName);
      const result = await orderApp.updateOrderStatus(user.identifier, orderId, request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, 'Failed to update order status');
      return c.json(errorResponse, status);
    }
  });

  // Hủy đơn hàng
  app.post('/orders/:orderId/cancel', async (c) => {
    try {
      const user = requireAuth(c);
      const orderId = c.req.param('orderId');
      const orderApp = createOrderApplicationService(c, bindingName);
      const result = await orderApp.cancelOrder(user.identifier, orderId);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = await handleError(c, e, 'Failed to cancel order');
      return c.json(errorResponse, status);
    }
  });

  return app;
}