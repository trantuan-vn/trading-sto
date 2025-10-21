import { Hono } from 'hono';
import { requireAuth } from '../../features/auth/authMiddleware';
import { createWebsocketApplicationService } from './application';
import { handleError } from '../../shared/utils';

export function createWebSocketRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // WebSocket connection endpoint
  app.get('/connect', async (c) => {
    try {
      const user = requireAuth(c);
      const wsApplicationService = createWebsocketApplicationService(c, bindingName);
      return wsApplicationService.connectWebSocketUseCase(user.identifier);

    } catch (e) {
      const { errorResponse, status } = handleError(e, "Failed to authenticate WebSocket");
      return c.json(errorResponse, status);
    }
  });

  // Broadcast message to all connected WebSocket clients (admin only)
  app.post('/broadcast', async (c) => {
    try {
      const user = requireAuth(c);
      if (user.role !== 'admin') {
        throw new Error('Unauthorized');
      }
      const request = c.req.raw;
      const data = await request.json();
      const wsApplicationService = createWebsocketApplicationService(c, bindingName);
      return wsApplicationService.broadcastMessageUseCase(JSON.stringify(data));

    } catch (e) {
      const { errorResponse, status } = handleError(e, "Failed to authenticate WebSocket");
      return c.json(errorResponse, status);
    }
  });
   return app;
}