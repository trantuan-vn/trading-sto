import { Hono, Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { createAuthMiddleware } from './authMiddleware.js'
// import { UserDO, type Env } from './UserDO.js'
import { UserDO, type User } from './UserDO.js' 
import {
  OTPRequestSchema, 
  OTPVerificationSchema, 
  SIWEAuthSchema,
  SetDataRequestSchema,
  type ErrorResponse,
  type SuccessResponse,
  type DataResponse,
} from './worker-types.js'

import { SiweMessage, generateNonce } from 'siwe';

// --- UTILITIES ---
const isRequestSecure = (c: Context) => new URL(c.req.url).protocol === 'https:';

const setAuthCookies = (c: Context, token: string, refreshToken: string) => {
  const cookieOptions = {
    httpOnly: true,
    secure: isRequestSecure(c),
    path: '/',
    sameSite: 'Lax' as const
  };
  setCookie(c, 'token', token, cookieOptions);
  setCookie(c, 'refreshToken', refreshToken, cookieOptions);
};

const clearAuthCookies = (c: Context) => {
  deleteCookie(c, 'token');
  deleteCookie(c, 'refreshToken');
};

const parseBody = async (c: Context, schema: any) => {
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/json')) {
    return schema.parse(await c.req.json());
  } else {
    const formData = await c.req.formData();
    const entries: { [key: string]: any } = {};
    formData.forEach((value, key) => {
      entries[key] = value;
    });
    return schema.parse(entries);
  }
};

const handleError = (e: any, defaultMessage: string) => {
  const errorResponse: ErrorResponse = { error: e.message || defaultMessage };
  return { errorResponse, status: 400 as const };
};

const requireAuth = (c: Context) => {
  const user = c.get('user');
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user;
};

// --- ROUTE FACTORY ---
function createRoutes(getUserDO: (c: Context, identifier: string) => UserDO) {
  const routes = new Hono<{ Bindings: Env, Variables: { user: User } }>();

  // CORS middleware (must come before auth middleware)
  routes.use('/*', cors({
    origin: (origin) => origin, // Allow all origins in development
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Allow cookies
  }));

  // Auth middleware
  routes.use('/*', createAuthMiddleware(getUserDO));

  // --- NEW AUTH ENDPOINTS ---
  routes.post('/api/otp/request', async (c) => {
      try {
          const { identifier } = await parseBody(c, OTPRequestSchema);
          const userDO = getUserDO(c, identifier);
          const result = await userDO.requestOTP({ identifier });
          return c.json(result);
      }
      catch (e) {
          const { errorResponse, status } = handleError(e, "OTP request failed");
          return c.json(errorResponse, status);
      }
  });

  routes.post('/api/otp/verify', async (c) => {
      try {
          const { identifier, otp } = await parseBody(c, OTPVerificationSchema);
          const userDO = getUserDO(c, identifier);
          const { user, token, refreshToken } = await userDO.verifyOTP({ identifier, otp });
          setAuthCookies(c, token, refreshToken);
          const response = { 
            success: true, 
            user: {
              id: user.id,
              identifier: user.identifier,
              address: user.address
            }
          };
          return c.json(response);
      }
      catch (e) {
          const { errorResponse, status } = handleError(e, "OTP verification failed");
          return c.json(errorResponse, status);
      }
  });

  // --- Thêm endpoint để lấy nonce ---
  routes.get('/api/wallet/nonce', async (c) => {
    try {
      const nonce = generateNonce();
      
      // Set nonce trong cookie
      setCookie(c, 'nonce', nonce, {
        httpOnly: true,
        secure: isRequestSecure(c),
        sameSite: 'Lax',
        maxAge: 300, // 5 minutes
        path: '/',
      });

      return c.json({ nonce });
    } catch (error) {
      console.error('Nonce generation error:', error);
      return c.json({ error: 'Failed to generate nonce' }, 500);
    }
  });

  routes.post('/api/wallet/connect', async (c) => {
      try {
          const { message, signature } = await parseBody(c, SIWEAuthSchema);        
          // Lấy nonce từ cookie
          const nonce = getCookie(c, 'nonce');
          if (!nonce) {
            return c.json({ error: 'Nonce not found' }, 400);
          }

          // Verify SIWE message
          const siweMessage = new SiweMessage(message);
          const { data: fields } = await siweMessage.verify({ signature });

          // Verify nonce
          if (fields.nonce !== nonce) {
            return c.json({ error: 'Invalid nonce' }, 400);
          }

          // Gọi backend để tạo/cập nhật user
          const address = fields.address.toLowerCase();
          const userDO = getUserDO(c, address);
          const { user, token, refreshToken } = await userDO.connectWallet({ address, signature });
          setAuthCookies(c, token, refreshToken);
          // Xóa nonce cookie sau khi sử dụng
          deleteCookie(c, 'nonce');
          const response = { 
            success: true, 
            user: {
              id: user.id,
              identifier: user.identifier,
              address: user.address
            }
          };
          return c.json(response);
      }
      catch (e) {
          const { errorResponse, status } = handleError(e, "Wallet connection failed");
          return c.json(errorResponse, status);
      }
  });  

  routes.post('/api/logout', async (c) => {
    try {
      const token = getCookie(c, 'token') || '';
      const tokenParts = token.split('.');
      if (tokenParts.length === 3 && tokenParts[1]) {
        const payload = JSON.parse(atob(tokenParts[1]));
        const identifier = payload.identifier?.toLowerCase();
        if (identifier) {
          const userDO = getUserDO(c, identifier);
          await userDO.logout();
        }
      }
    } catch (e) {
      console.error('Logout error', e);
    }
    clearAuthCookies(c);
    const response: SuccessResponse = { ok: true };
    return c.json(response);
  });

  routes.get('/api/me', async (c) => {
    try {
      const user = requireAuth(c);
      return c.json({ user });
    } catch (e: any) {
      const { errorResponse } = handleError(e, "Not authenticated");
      return c.json(errorResponse, 401);
    }
  });

  // --- DATA ENDPOINTS ---
  routes.get("/data", async (c) => {
    try {
      const user = requireAuth(c);
      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.get('data');
      const response: DataResponse = { ok: true, data: result };
      return c.json(response);
    } catch (e: any) {
      const { errorResponse } = handleError(e, "Unauthorized");
      return c.json(errorResponse, 401);
    }
  });

  routes.post("/data", async (c) => {
    try {
      const user = requireAuth(c);
      const { key, value } = await parseBody(c, SetDataRequestSchema);

      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.set(key, value);
      if (!result.ok) {
        throw new Error('Failed to set data');
      }

      // Broadcast WebSocket notification for data changes
      console.log(`🔥 Data changed for ${user.identifier}: ${key} = ${JSON.stringify(value)}`);
      broadcastToUser(user.identifier, {
        event: `kv:${key}`,
        data: { key, value },
        timestamp: Date.now()
      }, 'USERDO', c.env);

      const response: DataResponse = { ok: true, data: { key, value } };
      return c.json(response);
    } catch (e: any) {
      const { errorResponse, status } = handleError(e, 'Invalid data format');
      return c.json(errorResponse, status);
    }
  });

  routes.get('/protected/profile', (c) => {
    try {
      const user = requireAuth(c);
      return c.json({ ok: true, user });
    } catch (e: any) {
      const { errorResponse } = handleError(e, "Unauthorized");
      return c.json(errorResponse, 401);
    }
  });

  // --- ORGANIZATION ENDPOINTS ---
  routes.post('/api/organizations', async (c) => {
    try {
      const user = requireAuth(c);
      const { name } = await parseBody(c, { parse: (data: any) => ({ name: data.name }) });

      if (!name) {
        throw new Error('Organization name is required');
      }

      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.createOrganization(name);

      const contentType = c.req.header('content-type') || '';
      if (contentType.includes('application/json')) {
        return c.json(result);
      } else {
        return c.redirect('/organizations');
      }
    } catch (e: any) {
      const { errorResponse, status } = handleError(e, 'Failed to create organization');
      return c.json(errorResponse, status);
    }
  });

  routes.get('/api/organizations', async (c) => {
    try {
      const user = requireAuth(c);
      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.getOrganizations();
      return c.json(result);
    } catch (e: any) {
      const { errorResponse, status } = handleError(e, 'Failed to get organizations');
      return c.json(errorResponse, status);
    }
  });

  routes.get('/api/organizations/:id', async (c) => {
    try {
      const user = requireAuth(c);
      const organizationId = c.req.param('id');
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.getOrganization(organizationId);
      return c.json(result);
    } catch (e: any) {
      const { errorResponse, status } = handleError(e, 'Failed to get organization');
      return c.json(errorResponse, status);
    }
  });

  routes.post('/api/organizations/:id/members', async (c) => {
    try {
      const user = requireAuth(c);
      const organizationId = c.req.param('id');
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const { identifier, role = 'member' } = await parseBody(c, {
        parse: (data: any) => ({ identifier: data.identifier, role: data.role || 'member' })
      });

      if (!identifier) {
        throw new Error('identifier is required');
      }

      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.addOrganizationMember(organizationId, identifier.toLowerCase(), role);

      const contentType = c.req.header('content-type') || '';
      if (contentType.includes('application/json')) {
        return c.json(result);
      } else {
        return c.redirect(`/organizations/${organizationId}`);
      }
    } catch (e: any) {
      const { errorResponse, status } = handleError(e, 'Failed to add member');
      return c.json(errorResponse, status);
    }
  });

  routes.delete('/api/organizations/:id/members/:userId', async (c) => {
    try {
      const user = requireAuth(c);
      const organizationId = c.req.param('id');
      const userId = c.req.param('userId');

      if (!organizationId || !userId) {
        throw new Error('Organization ID and User ID are required');
      }

      const userDO = getUserDO(c, user.identifier);
      const result = await userDO.removeOrganizationMember(organizationId, userId);
      return c.json(result);
    } catch (e: any) {
      const { errorResponse, status } = handleError(e, 'Failed to remove member');
      return c.json(errorResponse, status);
    }
  });

  routes.get('/api/docs', async (c) => {
    return c.json({
      name: 'UserDO',
      version: '0.1.37',
      status: 'ready',
      endpoints: {
        auth: ['/api/signup', '/api/login', '/api/logout', '/api/me'],
        data: ['/data'],
        organizations: ['/api/organizations', '/api/organizations/:id', '/api/organizations/:id/members'],
        passwordReset: ['/api/password-reset/request', '/api/password-reset/confirm']
      },
      docs: 'https://github.com/acoyfellow/userdo'
    });
  });

  return routes;
}

// --- MAIN EXPORTS ---
export function getUserDOFromContext(c: Context, identifier: string, bindingName: string = 'USERDO'): UserDO {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const userDOID = binding.idFromName(identifier);
  return binding.get(userDOID) as unknown as UserDO;
}

export function createUserDOWorker(bindingName: string = 'USERDO') {
  return createRoutes((c, identifier) => getUserDOFromContext(c, identifier, bindingName));
}

export function broadcastToUser(identifier: string, message: any, bindingName: string = 'USERDO', env: any) {
  const binding = env[bindingName];
  if (!binding) {
    console.error(`Durable Object binding '${bindingName}' not found`);
    return;
  }

  const userDOID = binding.idFromName(identifier);
  const userDO = binding.get(userDOID);

  userDO.broadcast(message.event, message.data).catch((error: any) => {
    console.error('Failed to broadcast to UserDO:', error);
  });
}

export function createWebSocketHandler(bindingName: string = 'USERDO') {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === '/api/ws' && request.headers.get('upgrade') === 'websocket') {
        console.log('🔌 WebSocket upgrade request received');

        const cookieHeader = request.headers.get('cookie') || '';
        const cookies = Object.fromEntries(
          cookieHeader.split(';')
            .filter(c => c.includes('='))
            .map(c => c.trim().split('='))
        );

        const token = cookies.token || '';

        if (!token) {
          console.log('❌ No auth token for WebSocket');
          return new Response('Unauthorized', { status: 401 });
        }

        try {
          const parts = token.split('.');
          if (parts.length !== 3) throw new Error('Invalid token format');

          const payload = JSON.parse(atob(parts[1]));
          const identifier = payload.identifier?.toLowerCase();

          if (!identifier) throw new Error('No identifier in token');

          console.log(`🔌 WebSocket auth successful for: ${identifier}`);

          const binding = (env as any)[bindingName];
          if (!binding) {
            throw new Error(`Durable Object binding '${bindingName}' not found`);
          }

          const userDOID = binding.idFromName(identifier);
          const userDO = binding.get(userDOID);

          return userDO.fetch(request);

        } catch (error) {
          console.log('❌ WebSocket auth failed:', error);
          return new Response('Unauthorized', { status: 401 });
        }
      }

      return new Response('Not Found', { status: 404 });
    }
  };
}

// Create main app and export
const app = createRoutes(getUserDOFromContext);

export { UserDO };
export { app as userDOWorker };
export default app;