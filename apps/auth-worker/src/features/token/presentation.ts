import { Hono } from 'hono';
import { createTokenApplicationService } from './application';
import { CreateApiTokenSchema, RevokeApiTokenSchema } from './domain';
import { requireAuth } from '../auth/authMiddleware';
import { handleError } from '../../shared/utils';

export function createTokenRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Create new API token
  app.post('/create', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const request = CreateApiTokenSchema.parse(body);
      
      const tokenService = createTokenApplicationService(c, bindingName);
      const result = await tokenService.createApiTokenUseCase(user.identifier, request);
      return c.json(result);
    } catch (error) {
      const { errorResponse, status } = handleError(error, 'Failed to create API token');
      return c.json(errorResponse, status);
    }
  });

  // Get all user API tokens
  app.get('/list', async (c) => {
    try {
      const user = requireAuth(c);
      const tokenService = createTokenApplicationService(c, bindingName);
      const result = await tokenService.getUserApiTokensUseCase(user.identifier);
      return c.json(result);
    } catch (error) {
      const { errorResponse, status } = handleError(error, 'Failed to get API tokens');
      return c.json(errorResponse, status);
    }
  });
  // Revoke specific API token
  app.delete('/revoke/:tokenId', async (c) => {
    try {
      const user = requireAuth(c);
      const tokenId = c.req.param('tokenId');
      const request = RevokeApiTokenSchema.parse({ tokenId });
      const tokenService = createTokenApplicationService(c, bindingName);
      const result = await tokenService.revokeApiTokenUseCase(user.identifier, request);
      return c.json(result);
    } catch (error) {
      const { errorResponse, status } = handleError(error, 'Failed to revoke API token');
      return c.json(errorResponse, status);
    }
  });
  // Revoke all API tokens
  app.delete('/revoke-all', async (c) => {
    try {
      const user = requireAuth(c);
      const tokenService = createTokenApplicationService(c, bindingName);
      const result = await tokenService.revokeAllApiTokensUseCase(user.identifier);
      return c.json(result);
    } catch (error) {
      const { errorResponse, status } = handleError(error, 'Failed to revoke all API tokens');
      return c.json(errorResponse, status);
    }
  });
  

  return app;
}