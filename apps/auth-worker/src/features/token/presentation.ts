import { Hono } from 'hono';
import { createTokenApplicationService } from './application';
import { CreateApiTokenSchema, RevokeApiTokenSchema, ValidateApiTokenSchema } from './domain';
import { requireAuth } from '../auth/authMiddleware';
import { requirePermissions } from './authMiddleware';

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
      return c.json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 400);
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
      return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
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
      return c.json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 400);
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
      return c.json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 400);
    }
  });
  
  // Record token usage
  app.post('/usage', async (c) => {
    try {
      const user = requireAuth(c);
      const body = await c.req.json();
      const tokenService = createTokenApplicationService(c, bindingName);
      await tokenService.recordTokenUsageUseCase(user.identifier, body);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 400);
    }
  });

  // Get token usage statistics
  app.get('/usage/:tokenId', async (c) => {
    try {
      const user = requireAuth(c);
      const tokenId = c.req.param('tokenId');
      const days = c.req.query('days') ? parseInt(c.req.query('days')!) : 30;
      const tokenService = createTokenApplicationService(c, bindingName);
      const result = await tokenService.getTokenUsageUseCase(user.identifier, tokenId, days);
      return c.json(result);
    } catch (error) {
      return c.json({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 400);
    }
  });

  return app;
}