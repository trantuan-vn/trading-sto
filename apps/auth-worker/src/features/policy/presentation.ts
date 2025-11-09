import { Hono } from 'hono';
import { createPriceApplicationService } from './application';
import { CreatePricePolicySchema, UpdatePricePolicySchema } from './domain';
import { requireAuth } from '../auth/authMiddleware';
import { handleError } from '../../shared/utils';

export function createPriceRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Tạo chính sách giá mới
  app.post('/policies', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const request = CreatePricePolicySchema.parse(body);
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.createPricePolicy(user.identifier, request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to create price policy');
      return c.json(errorResponse, status);
    }
  });

  // Cập nhật chính sách giá
  app.put('/policies/:policyId', async (c) => {
    try {
      const user = requireAuth(c);
      const policyId = c.req.param('policyId');
      const body = await c.req.json();
      const request = UpdatePricePolicySchema.parse(body);
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.updatePricePolicy(user.identifier, policyId, request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to update price policy');
      return c.json(errorResponse, status);
    }
  });

  // Lấy danh sách chính sách giá
  app.get('/policies', async (c) => {
    try {
      const user = requireAuth(c);
      const status = c.req.query('status') as 'ACTIVE' | 'INACTIVE' | undefined;
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.getPricePolicies(user.identifier, status);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get price policies');
      return c.json(errorResponse, status);
    }
  });

  // Lấy chi tiết chính sách giá
  app.get('/policies/:policyId', async (c) => {
    try {
      const user = requireAuth(c);
      const policyId = c.req.param('policyId');
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.getPricePolicy(user.identifier, policyId);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get price policy');
      return c.json(errorResponse, status);
    }
  });

  // Xóa chính sách giá
  app.delete('/policies/:policyId', async (c) => {
    try {
      const user = requireAuth(c);
      const policyId = c.req.param('policyId');
      const priceApp = createPriceApplicationService(c, bindingName);
      await priceApp.deletePricePolicy(user.identifier, policyId);
      return c.json({ success: true });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to delete price policy');
      return c.json(errorResponse, status);
    }
  });

  // Tính toán giá cho service
  app.post('/calculate/service', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.calculateServicePrice(user.identifier, body);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to calculate service price');
      return c.json(errorResponse, status);
    }
  });

  // Tính toán giá cho user
  app.post('/calculate/user', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.calculateUserPrice(user.identifier, body);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to calculate user price');
      return c.json(errorResponse, status);
    }
  });

  // Kích hoạt/vô hiệu hóa chính sách giá
  app.patch('/policies/:policyId/status', async (c) => {
    try {
      const user = requireAuth(c);
      const policyId = c.req.param('policyId');
      const body = await c.req.json();
      const priceApp = createPriceApplicationService(c, bindingName);
      const result = await priceApp.updatePolicyStatus(user.identifier, policyId, body.status);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to update policy status');
      return c.json(errorResponse, status);
    }
  });

  return app;
}