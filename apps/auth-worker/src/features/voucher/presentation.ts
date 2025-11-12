import { Hono } from 'hono';
import { createVoucherApplicationService } from './application';
import { CreateVoucherSchema, ApplyVoucherSchema } from './domain';
import { requireAuth } from '../auth/authMiddleware';
import { handleError } from '../../shared/utils';

export function createVoucherRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Tạo voucher mới
  app.post('/vouchers', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const body = await c.req.json();
      const request = CreateVoucherSchema.parse(body);
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.createVoucher('system', request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to create voucher');
      return c.json(errorResponse, status);
    }
  });

  // Áp dụng voucher vào service
  app.post('/apply/service', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const body = await c.req.json();
      const request = ApplyVoucherSchema.parse(body);
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.applyServiceVoucher('system', request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to apply voucher to service');
      return c.json(errorResponse, status);
    }
  });

  // Áp dụng voucher cho user
  app.post('/apply/user', async (c) => {
    try {
      const user = requireAuth(c);
            if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const body = await c.req.json();
      const request = ApplyVoucherSchema.parse(body);
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.applyUserVoucher('system', request);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to apply voucher to user');
      return c.json(errorResponse, status);
    }
  });

  // Lấy danh sách voucher
  app.get('/vouchers', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const status = c.req.query('status') as 'ACTIVE' | 'INACTIVE' | undefined;
      const targetType = c.req.query('targetType') as 'SERVICE' | 'USER' | undefined;
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.getVouchers('system', status, targetType);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get vouchers');
      return c.json(errorResponse, status);
    }
  });

  // Lấy thông tin voucher bằng code
  app.get('/code/:voucherCode', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const voucherCode = c.req.param('voucherCode');
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.getVoucherByCode('system', voucherCode);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get voucher');
      return c.json(errorResponse, status);
    }
  });

  // Validate voucher cho service
  app.post('/validate/service', async (c) => {
    try {
      const user = requireAuth(c);
            if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const body = await c.req.json();
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.validateServiceVoucher('system', body);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to validate service voucher');
      return c.json(errorResponse, status);
    }
  });

  // Validate voucher cho user
  app.post('/validate/user', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const body = await c.req.json();
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.validateUserVoucher('system', body);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to validate user voucher');
      return c.json(errorResponse, status);
    }
  });

  // Hủy/vô hiệu hóa voucher
  app.patch('/vouchers/:voucherId/status', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const voucherId = c.req.param('voucherId');
      const body = await c.req.json();
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.updateVoucherStatus('system', voucherId, body.status);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to update voucher status');
      return c.json(errorResponse, status);
    }
  });

  // Lấy lịch sử sử dụng voucher
  // app.get('/usage/:voucherId', async (c) => {
  //   try {
  //     const user = requireAuth(c);
  //     const voucherId = c.req.param('voucherId');
  //     const voucherApp = createVoucherApplicationService(c, bindingName);
  //     const result = await voucherApp.getVoucherUsage(user.identifier, voucherId);
  //     return c.json(result);
  //   } catch (e) {
  //     const { errorResponse, status } = handleError(e, 'Failed to get voucher usage');
  //     return c.json(errorResponse, status);
  //   }
  // });

  // Lấy vouchers khả dụng cho service
  app.get('/available/services', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const serviceId = c.req.query('serviceId');
      const basePrice = parseFloat(c.req.query('basePrice') || '0');
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.getAvailableServiceVouchers('system', serviceId, basePrice);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get available service vouchers');
      return c.json(errorResponse, status);
    }
  });

  // Lấy vouchers khả dụng cho user
  app.get('/available/users', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const userId = c.req.query('userId');
      const userRole = c.req.query('userRole') as 'member' | 'admin' | undefined;
      const basePrice = parseFloat(c.req.query('basePrice') || '0');
      const voucherApp = createVoucherApplicationService(c, bindingName);
      const result = await voucherApp.getAvailableUserVouchers('system', userId, userRole, basePrice);
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to get available user vouchers');
      return c.json(errorResponse, status);
    }
  });

  return app;
}