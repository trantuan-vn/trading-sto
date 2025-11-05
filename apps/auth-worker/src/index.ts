import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createAuthMiddleware } from './features/auth/authMiddleware';
import { createTokenValidationMiddleware, securityHeadersMiddleware, securityLoggingMiddleware } from './features/token/authMiddleware';
import { createAuthRoutes } from './features/auth/presentation';
import { createTokenRoutes } from './features/token/presentation';
import { createDashboardWebSocketRoutes, createApiWebSocketRoutes } from './features/ws/presentation';
import { createEkycRoutes } from './features/ekyc/presentation';

export { UserDO } from './features/ws/infrastructure/UserDO';
export { BroadcastServiceDO } from './features/ws/infrastructure/BroadcastServiceDO';
export { UserShardDO } from './features/ws/infrastructure/UserShardDO';

// I. CREATE ROUTES
function createRoutes(bindingName: string) {
  const routes = new Hono<{ Bindings: Env }>();
  // Security middleware
  routes.use('*', securityLoggingMiddleware()); 
  // Security headers
  routes.use('*', securityHeadersMiddleware());
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

  // I. DASHBOARD
  // Auth middleware
  routes.use('/dashboard/*', createAuthMiddleware(bindingName));  
  // sub routes /auth
  routes.route('/dashboard/auth', createAuthRoutes(bindingName));  
  routes.route('/dashboard/token', createTokenRoutes(bindingName)); 
  routes.route('/dashboard/ws', createDashboardWebSocketRoutes(bindingName));  
  
  // II. API
  routes.use('/api/*', createTokenValidationMiddleware(bindingName));  
  routes.route('/api/ekyc', createEkycRoutes(bindingName));
  routes.route('/api/ws', createApiWebSocketRoutes(bindingName));

  return routes;
}
const routeApp = createRoutes("USER_DO");

// III. CREATE MAIN APP
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return routeApp.fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env, Error>;