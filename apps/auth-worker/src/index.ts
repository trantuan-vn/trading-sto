import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createAuthMiddleware, requireAuth } from './features/auth/authMiddleware';
import { createAuthRoutes } from './features/auth/presentation';
import { createTokenRoutes } from './features/token/presentation';
import { createWebSocketRoutes } from './features/ws/presentation';

// I. CREATE ROUTES
function createRoutes(bindingName: string) {
  const routes = new Hono<{ Bindings: Env }>();
  // CORS middleware (must come before auth middleware)
  routes.use('/*', cors({
    origin: [
      'https://beta.unitoken.trade',
      'https://www.beta.unitoken.trade',
      'https://unitoken.trade',
      'https://www.unitoken.trade'
    ], 
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true, 
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));

  // Auth middleware
  routes.use('*', createAuthMiddleware(bindingName));  
  // sub routes /auth
  routes.route('/auth', createAuthRoutes(bindingName));  
  routes.route('/token', createTokenRoutes(bindingName));  
  routes.route('/ws', createWebSocketRoutes(bindingName));  

  return routes;
}
const routeApp = createRoutes("USER_DO");

// III. CREATE MAIN APP
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return routeApp.fetch(request, env, ctx);
  }
};