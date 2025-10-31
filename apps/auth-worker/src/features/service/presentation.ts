import { Hono } from 'hono';
import { createServiceApplicationService } from './application';
import { RegisterServiceSchema, VNPayPaymentSchema, ServiceUsageSchema } from './domain';
import { requireAuth } from '../auth/authMiddleware';
import { handleError } from '../../shared/utils';

export function createServiceRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Đăng ký dịch vụ
  app.post('/register', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const request = RegisterServiceSchema.parse(body);
      const serviceApp = createServiceApplicationService(c, bindingName);
      const result = await serviceApp.registerService(user.identifier, request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to register service');
      return c.json(errorResponse, status);
    }
  });

  // Lấy danh sách dịch vụ
  app.get('/list', async (c) => {
    try {
      const user = requireAuth(c);
      const serviceApp = createServiceApplicationService(c, bindingName);
      const result = await serviceApp.getUserServices(user.identifier);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get services');
      return c.json(errorResponse, status);
    }
  });

  // Hủy dịch vụ
  app.delete('/cancel/:serviceId', async (c) => {
    try {
      const user = requireAuth(c);
      const serviceId = c.req.param('serviceId');
      const serviceApp = createServiceApplicationService(c, bindingName);
      await serviceApp.cancelService(user.identifier, serviceId);
      return c.json({ success: true });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to cancel service');
      return c.json(errorResponse, status);
    }
  });

  // Xử lý thanh toán VNPay
  app.post('/vnpay-payment', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const request = VNPayPaymentSchema.parse(body);
      const serviceApp = createServiceApplicationService(c, bindingName);
      const result = await serviceApp.processVNPayPayment(user.identifier, request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to process VNPay payment');
      return c.json(errorResponse, status);
    }
  });

  // Ghi lại sử dụng endpoint
  app.post('/usage', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const usage = ServiceUsageSchema.parse({
        ...body,
        timestamp: new Date().toISOString(),
        userAgent: c.req.header('User-Agent'),
        ipAddress: c.req.header('CF-Connecting-IP'),
      });
      const serviceApp = createServiceApplicationService(c, bindingName);
      await serviceApp.recordEndpointUsage(user.identifier, usage);
      return c.json({ success: true });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to record endpoint usage');
      return c.json(errorResponse, status);
    }
  });

  // Lấy lịch sử sử dụng dịch vụ
  app.get('/usage/:serviceId', async (c) => {
    try {
      const user = requireAuth(c);
      const serviceId = c.req.param('serviceId');
      const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 30;
      const serviceApp = createServiceApplicationService(c, bindingName);
      const result = await serviceApp.getServiceUsage(user.identifier, serviceId, days);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get service usage');
      return c.json(errorResponse, status);
    }
  });

  return app;
}