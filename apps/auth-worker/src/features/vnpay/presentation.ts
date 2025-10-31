import { Hono } from 'hono';
import { handleError } from '../../shared/utils';
import { createPaymentApplicationService } from './application';
import { requireAuth } from '../auth/authMiddleware';

export function createPaymentRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper to get client IP
  const getClientIp = (c: any): string => {
    return c.req.header('x-forwarded-for') ||
           c.req.header('x-real-ip') ||
           'unknown';
  };

  // Create payment URL
  app.post('/create_payment_url', async (c) => {
    try {
      const user = requireAuth(c);
      const request = await c.req.json();
      const ipAddr = getClientIp(c);
      
      const paymentService = createPaymentApplicationService(c, bindingName);
      const result = await paymentService.createPaymentUrlUseCase(user.identifier, request, ipAddr);
      
      return c.json({
        success: true,
        data: result
      });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to create payment URL');
      return c.json(errorResponse, status);
    }
  });

  // VNPay return URL
  app.get('/vnpay_return', async (c) => {
    try {
      const user = requireAuth(c);
      const params = c.req.query();
      
      const paymentService = createPaymentApplicationService(c, bindingName);
      const result = await paymentService.processReturnUseCase(user.identifier, params);
      
      // Render success page with result
      return c.json({
        success: result.success,
        code: result.code,
        message: result.message,
        orderId: result.orderId,
        amount: result.amount
      });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to process return');
      return c.json(errorResponse, status);
    }
  });

  // VNPay IPN URL
  app.get('/vnpay_ipn', async (c) => {
    try {
      const user = requireAuth(c);
      const params = c.req.query();
      
      const paymentService = createPaymentApplicationService(c, bindingName);
      const result = await paymentService.processIPNUseCase(user.identifier, params);
      
      return c.json({
        RspCode: result.code,
        Message: result.message
      });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to process IPN');
      return c.json(errorResponse, status);
    }
  });

  // Query transaction
  app.post('/querydr', async (c) => {
    try {
      const user = requireAuth(c);
      const request = await c.req.json();
      const ipAddr = getClientIp(c);
      
      const paymentService = createPaymentApplicationService(c, bindingName);
      const result = await paymentService.queryTransactionUseCase(user.identifier, request, ipAddr);
      
      return c.json({
        success: result.responseCode === '00',
        data: result
      });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to query transaction');
      return c.json(errorResponse, status);
    }
  });

  // Refund transaction
  app.post('/refund', async (c) => {
    try {
      const user = requireAuth(c);
      const request = await c.req.json();
      const ipAddr = getClientIp(c);
      
      const paymentService = createPaymentApplicationService(c, bindingName);
      const result = await paymentService.refundTransactionUseCase(user.identifier, request, ipAddr);
      
      return c.json({
        success: result.responseCode === '00',
        data: result
      });
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Failed to process refund');
      return c.json(errorResponse, status);
    }
  });

  return app;
}