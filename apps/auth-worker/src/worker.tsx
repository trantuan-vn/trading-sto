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
  GetDataRequestSchema,
  type ErrorResponse,
  type SuccessResponse,
  type DataResponse,
  OAuthCallbackSchema,
  OAuthTokenResponseSchema,
  type OAuthCallback,
  type OAuthTokenResponse,
  type OAuthConfig,
  type OAuthProvider,
  GoogleUserInfoSchema,
  AppleUserInfoSchema,
  FacebookUserInfoSchema,
  GitHubUserInfoSchema,
  TwitterUserInfoSchema,
  type GoogleUserInfo,
  type AppleUserInfo,
  type FacebookUserInfo,
  type GitHubUserInfo,
  type TwitterUserInfo
} from './worker-types.js'

import { SiweMessage, generateNonce } from 'siwe';

// --- UTILITIES ---
const isRequestSecure = (c: Context) => new URL(c.req.url).protocol === 'https:';

const setCookieWithOption = (c: Context, name: string, value: string, maxAge: number) => {
  const cookieOptions = {
    sameSite: 'none' as const, 
    httpOnly: true,
    secure: true,
    path: '/',
    domain: '.unitoken.trade',
    maxAge: maxAge,
  };
  setCookie(c, name, value, cookieOptions);
};

const clearAuthCookies = (c: Context) => {
  deleteCookie(c, 'token', {
    path: '/',
    domain: '.unitoken.trade',
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  });
  deleteCookie(c, 'refreshToken', {
    path: '/',
    domain: '.unitoken.trade',
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  });
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

// --- Helper functions for OAuth ---
// --- Cập nhật hàm exchangeOAuthCode với type safety ---
async function exchangeOAuthCode(provider: string, code: string, env: Env): Promise<OAuthTokenResponse> {
  const debug = env.DEBUG === "true";
  const log = (...args: any[]) => { if (debug) console.log(...args); };
  const err = (...args: any[]) => { if (debug) console.error(...args); };

  try {
    log("== [exchangeOAuthCode] START ==");
    log("Provider:", provider, "Code:", code);

    const config = getOAuthConfig(provider, env);
    log("OAuth config:", {
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      tokenEndpoint: config.tokenEndpoint,
    });

    const params = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });

    log("Sending token exchange request to:", config.tokenEndpoint);
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json', // Request JSON response
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      err("Token exchange failed:", errorText);
      throw new Error(`OAuth token exchange failed: ${errorText}`);
    }

    const tokenData = await response.json();
    log("Parsed JSON response:", tokenData);
    return OAuthTokenResponseSchema.parse(tokenData);
  } catch (e) {
    err("exchangeOAuthCode failed:", e);
    const { errorResponse, status } = handleError(e, `OAuth token exchange failed for ${provider}`);
    throw { errorResponse, status };
  }  
}

// --- Cập nhật hàm getUserInfoFromProvider với validation ---
async function getUserInfoFromProvider(provider: string, accessToken: string, env: Env): Promise<any> {
  const debug = env.DEBUG === "true";
  const log = (...args: any[]) => { if (debug) console.log(...args); };
  const err = (...args: any[]) => { if (debug) console.error(...args); };

  try {
    log("== [getUserInfoFromProvider] START ==");
    log("Provider:", provider, "AccessToken:", accessToken.slice(0, 10) + "...");

    const config = getOAuthConfig(provider, env);
    log("OAuth config:", { userInfoEndpoint: config.userInfoEndpoint });

    log("Fetching user info from:", config.userInfoEndpoint);
    const response = await fetch(config.userInfoEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'YourAppName', // Added for GitHub compatibility
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      err("Failed to fetch user info:", response.status, errorText);
      throw new Error(`Failed to get user info from ${provider}: ${response.status} ${errorText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    log("Response Content-Type:", contentType);

    if (!contentType.includes('application/json')) {
      const text = await response.text();
      err("Unexpected response format:", contentType, "Response:", text);
      throw new Error(`Unexpected response format from ${provider}: ${contentType}`);
    }

    const userInfo = await response.json();
    log("Raw user info:", userInfo);

    // Validate user info based on provider
    log("Validating user info for provider:", provider);
    let validatedUserInfo: any;
    switch (provider) {
      case 'google':
        validatedUserInfo = GoogleUserInfoSchema.parse(userInfo);
        break;
      case 'apple':
        validatedUserInfo = AppleUserInfoSchema.parse(userInfo);
        break;
      case 'facebook':
        validatedUserInfo = FacebookUserInfoSchema.parse(userInfo);
        break;
      case 'github':
        validatedUserInfo = GitHubUserInfoSchema.parse(userInfo);
        break;
      case 'twitter':
        validatedUserInfo = TwitterUserInfoSchema.parse(userInfo);
        break;
      default:
        err("Unsupported provider:", provider);
        throw new Error(`Unsupported provider: ${provider}`);
    }

    log("Validated user info:", validatedUserInfo);
    log("== [getUserInfoFromProvider] SUCCESS ==");
    return validatedUserInfo;

  } catch (e) {
    err("getUserInfoFromProvider failed:", e);
    const { errorResponse, status } = handleError(e, `Failed to get user info from ${provider}`);
    throw { errorResponse, status };
  }
}

function getOAuthConfig(provider: string, env?: Env): OAuthConfig {
  const configs: { [key: string]: OAuthConfig } = {
    google: {
      clientId: env?.GOOGLE_CLIENT_ID || "",
      clientSecret: env?.GOOGLE_CLIENT_SECRET || "",
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      userInfoEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',
      redirectUri: `${getBaseUrl()}/api/oauth/google/callback`
    },
    apple: {
      clientId: env?.APPLE_CLIENT_ID || "",
      clientSecret: env?.APPLE_CLIENT_SECRET || "",
      tokenEndpoint: 'https://appleid.apple.com/auth/token',
      userInfoEndpoint: 'https://appleid.apple.com/auth/userinfo',
      redirectUri: `${getBaseUrl()}/api/oauth/apple/callback`
    },
    facebook: {
      clientId: env?.FACEBOOK_CLIENT_ID || "",
      clientSecret: env?.FACEBOOK_CLIENT_SECRET || "",
      tokenEndpoint: 'https://graph.facebook.com/v18.0/oauth/access_token',
      userInfoEndpoint: 'https://graph.facebook.com/me?fields=id,name,email',
      redirectUri: `${getBaseUrl()}/api/oauth/facebook/callback`
    },
    github: {
      clientId: env?.GITHUB_CLIENT_ID || "",
      clientSecret: env?.GITHUB_CLIENT_SECRET || "",
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      userInfoEndpoint: 'https://api.github.com/user',
      redirectUri: `${getBaseUrl()}/api/oauth/github/callback`
    },
    twitter: {
      clientId: env?.TWITTER_CLIENT_ID || "",
      clientSecret: env?.TWITTER_CLIENT_SECRET || "",
      tokenEndpoint: 'https://api.x.com/2/oauth2/token',
      userInfoEndpoint: 'https://api.x.com/2/users/me',
      redirectUri: `${getBaseUrl()}/api/oauth/twitter/callback`
    }
  };

  const config = configs[provider];
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`OAuth configuration missing for ${provider}`);
  }

  return config;
}

// --- Cập nhật hàm normalizeOAuthIdentifier với type safety ---
function normalizeOAuthIdentifier(provider: string, userInfo: any): string {
  switch (provider) {
    case 'google':
      const googleInfo = userInfo as GoogleUserInfo;
      return googleInfo.email.toLowerCase();
    
    case 'apple':
      const appleInfo = userInfo as AppleUserInfo;
      return appleInfo.email.toLowerCase();
    
    case 'facebook':
      const fbInfo = userInfo as FacebookUserInfo;
      return fbInfo.email?.toLowerCase() || `fb_${fbInfo.id}@oauth.user`;
    
    case 'github':
      const ghInfo = userInfo as GitHubUserInfo;
      return ghInfo.email?.toLowerCase() || `gh_${ghInfo.login}@oauth.user`;
    
    case 'twitter':
      const twInfo = userInfo as TwitterUserInfo;
      return `tw_${twInfo.data.username}@oauth.user`;
    
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function getFrontendUrl(c: Context): string {
  // Lấy frontend URL từ env hoặc request origin
  return c.env.FRONTEND_URL || new URL(c.req.url).origin;
}

function getBaseUrl(): string {
  // Trả về base URL của ứng dụng
  return 'https://api.unitoken.trade';
}

function getOAuthAuthorizationUrl(provider: OAuthProvider, env: Env): string {
  const config = getOAuthConfig(provider, env);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: getOAuthScopes(provider),
    state: generateState(), // CSRF protection
  });

  switch (provider) {
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    case 'apple':
      return `https://appleid.apple.com/auth/authorize?${params}`;
    case 'facebook':
      return `https://www.facebook.com/v18.0/dialog/oauth?${params}`;
    case 'github':
      return `https://github.com/login/oauth/authorize?${params}`;
    case 'twitter':
      return `https://x.com/i/oauth2/authorize?${params}`;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function getOAuthScopes(provider: OAuthProvider): string {
  const scopes: Record<OAuthProvider, string> = {
    google: "openid email profile",
    apple: "name email",
    facebook: "email",
    github: "user:email",
    twitter: "users.read tweet.read",
  };
  return scopes[provider];
}

function generateState(): string {
  return crypto.randomUUID();
}
// --- Thêm hàm xử lý OAuth error ---
function handleOAuthError(c: Context, error: any, provider: string) {
  console.error(`OAuth error for ${provider}:`, error);
  
  const errorParams = new URLSearchParams({
    provider,
    error: error instanceof Error ? error.message : 'unknown_error',
  });

  return c.redirect(`${getFrontendUrl(c)}/auth/error?${errorParams}`);
}

// nonce functions
async function storeNonce(env: Env, sessionId: string, nonce: string) {
  const rec = { nonce, issuedAt: Date.now() };
  await env.NONCE_KV.put(`siwe:${sessionId}`, JSON.stringify(rec), { expirationTtl: 300 });
}

async function getNonce(env: Env, sessionId: string) {
  const raw = await env.NONCE_KV.get(`siwe:${sessionId}`);
  return raw ? JSON.parse(raw) : null;
}

async function markNonceUsed(env: Env, sessionId: string) {
  const rec = await getNonce(env, sessionId);
  if (rec) {
    rec.used = true;
    await env.NONCE_KV.put(`siwe:${sessionId}`, JSON.stringify(rec), { expirationTtl: 60 });
  }
}
async function deleteNonce(env: Env, sessionId: string) {
  await env.NONCE_KV.delete(`siwe:${sessionId}`);
}

// --- ROUTE FACTORY ---
function createRoutes(getUserDO: (c: Context, identifier: string) => UserDO) {
  const routes = new Hono<{ Bindings: Env, Variables: { user: User } }>();

  // CORS middleware (must come before auth middleware)
  routes.use('/*', cors({
    origin: [
      'https://beta.unitoken.trade',
      'https://www.beta.unitoken.trade',
      'https://unitoken.trade',
      'https://www.unitoken.trade'
    ], 
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Allow cookies
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }));

  // Auth middleware
  routes.use('/*', createAuthMiddleware(getUserDO));  

  // ---  oauth AUTH ENDPOINTS ---
  // --- Thêm endpoint để lấy OAuth URL ---
  routes.get('/api/oauth/:provider/url', async (c) => {
    const debug = c.env.DEBUG === "true"; 
    const log = (...args: any[]) => { if (debug) console.log(...args); };
    const err = (...args: any[]) => { if (debug) console.error(...args); };

    try {
      log("== [/api/oauth/:provider/url] request IN ==");
      const provider = c.req.param('provider') as 'google' | 'apple' | 'facebook' | 'github' | 'twitter';
      
      log("Provider:", provider);
      if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
        err("Invalid OAuth provider:", provider);
        return c.json({ error: 'Invalid OAuth provider' }, 400);
      }

      const authUrl = getOAuthAuthorizationUrl(provider, c.env);
      log("Generated OAuth URL:", authUrl);
      
      log("== [/api/oauth/:provider/url] SUCCESS ==");
      return c.json({ url: authUrl });

    } catch (e) {
      err("Failed to get OAuth URL:", e);
      const { errorResponse, status } = handleError(e, "Failed to get OAuth URL");
      return c.json(errorResponse, status);
    }
  });

  routes.get('/api/oauth/:provider/callback', async (c) => {
    const debug = c.env.DEBUG === "true"; 
    const log = (...args: any[]) => { if (debug) console.log(...args); };
    const err = (...args: any[]) => { if (debug) console.error(...args); };

    try {
      log("== [/api/oauth/:provider/callback] request IN ==");
      const provider = c.req.param('provider') as 'google' | 'apple' | 'facebook' | 'github' | 'twitter';
      
      log("Provider:", provider);
      // Check for OAuth errors
      const error = c.req.query('error');
      if (error) {
        err("OAuth error:", error, c.req.query('error_description'));
        const { errorResponse, status } = handleError(new Error(c.req.query('error_description') || error), `Check for OAuth error for ${provider}`);
        return c.json(errorResponse, status);
      }

      const { code, state } = OAuthCallbackSchema.parse(c.req.query());
      log("Parsed query params:", { code, state });

      // Validate provider
      if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
        err("Invalid OAuth provider:", provider);
        const { errorResponse, status } = handleError(new Error('Invalid OAuth provider'), `Validate provider error for ${provider}`);
        return c.json(errorResponse, status);
      }

      // Exchange code for tokens
      log("Exchanging OAuth code...");
      const tokenData = await exchangeOAuthCode(provider, code, c.env);
      log("Token data:", tokenData);
      
      // Get user info from provider
      log("Fetching user info...");
      const userInfo = await getUserInfoFromProvider(provider, tokenData.access_token, c.env);
      log("User info:", userInfo);
      
      // Normalize identifier based on provider
      const identifier = normalizeOAuthIdentifier(provider, userInfo);
      log("Normalized identifier:", identifier);
      
      // Find or create user
      log("Getting user durable object...");
      const userDO = getUserDO(c, identifier);
      
      const { user, token, refreshToken } = await userDO.connectOAuth(provider, identifier, tokenData, userInfo);
      log("UserDO result:", { user, token, refreshToken });

      setCookieWithOption(c, "token", token, 10*60);
      setCookieWithOption(c, "refreshToken", refreshToken, 7*24*60*60);
      log("Auth cookies set");

      const redirectUrl = `${getFrontendUrl(c)}`;
      log("Redirecting to:", redirectUrl);

      log("== [/api/oauth/:provider/callback] SUCCESS ==");
      return c.redirect(redirectUrl);

    } catch (e) {
      err("OAuth callback failed:", e);
      const { errorResponse, status } = handleError(e, "OAuth callback failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });  
  
  // ---  email/phone AUTH ENDPOINTS ---
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
          setCookieWithOption(c, "token", token, 10*60);
          setCookieWithOption(c, "refreshToken", refreshToken, 7*24*60*60);
          return c.json({ ok: true });
      }
      catch (e) {
          const { errorResponse, status } = handleError(e, "OTP verification failed");
          clearAuthCookies(c);
          return c.json(errorResponse, status);
      }
  });

  // ---  wallet endpoint để lấy nonce/connect ---
  routes.get('/api/wallet/nonce', async (c) => {
    try {
      const nonce = generateNonce();
      const sessionId = crypto.randomUUID(); // session id ngẫu nhiên
      
      // Lưu nonce vào KV
      await storeNonce(c.env, sessionId, nonce);

      // Set cookie session
      setCookieWithOption(c, "siwe_session", sessionId, 5*60);

      return c.json({ nonce });
    } catch (error) {
      console.error('Nonce generation error:', error);
      return c.json({ error: 'Failed to generate nonce' }, 500);
    }
  });


  routes.post('/api/wallet/connect', async (c) => {
    const debug = c.env.DEBUG === "true"; 
    const log = (...args: any[]) => { if (debug) console.log(...args); };
    const err = (...args: any[]) => { if (debug) console.error(...args); };

    try {
      log("== [/api/wallet/connect] request IN ==");

      // Origin check
      const origin = c.req.header('origin') || c.req.header('referer');
      log("Origin:", origin, "FRONTEND_URL:", c.env.FRONTEND_URL);

      if (!origin || !origin.startsWith(c.env.FRONTEND_URL)) {
        err("Bad origin check failed");
        return c.json({ error: 'Bad origin' }, 403);
      }

      const { message, signature } = await parseBody(c, SIWEAuthSchema);
      log("Parsed body:", { message, signature });

      // Lấy sessionId từ cookie
      const sessionId = getCookie(c, 'siwe_session');
      log("SessionId:", sessionId);

      if (!sessionId) {
        err("Session not found");
        return c.json({ error: 'Session not found' }, 400);
      }

      const rec = await getNonce(c.env, sessionId);
      log("Nonce record:", rec);

      if (!rec || rec.used) {
        err("Nonce expired or used", rec);
        return c.json({ error: 'Nonce expired or used' }, 400);
      }

      // Verify SIWE
      log("Start SIWE verify...");
      const siweMessage = new SiweMessage(message);
      log("SIWE parsed message:", siweMessage);

      const sig = signature.startsWith("0x") ? signature : `0x${signature}`;
      const { data: fields } = await siweMessage.verify({ signature: sig });
      log("SIWE verified fields:", fields);

      // Kiểm tra nonce khớp
      if (fields.nonce !== rec.nonce) {
        err("Nonce mismatch", { expected: rec.nonce, got: fields.nonce });
        return c.json({ error: 'Invalid nonce' }, 400);
      }

      // Check expiry (5 phút)
      if (Date.now() - rec.issuedAt > 5 * 60 * 1000) {
        err("Nonce expired", { issuedAt: rec.issuedAt });
        await deleteNonce(c.env, sessionId);
        return c.json({ error: 'Nonce expired' }, 400);
      }

      // Mark nonce used
      await markNonceUsed(c.env, sessionId);

      // Tạo/cập nhật user
      const address = fields.address.toLowerCase();
      log("Verified wallet address:", address);

      const userDO = getUserDO(c, address);
      const { user, token, refreshToken } = await userDO.connectWallet({ address, signature });
      log("UserDO result:", { user, token, refreshToken });

      setCookieWithOption(c, "token", token, 10*60);
      setCookieWithOption(c, "refreshToken", refreshToken, 7*24*60*60);      
      deleteCookie(c, 'siwe_session', {
        path: '/',
        domain: '.unitoken.trade',
        secure: true,
        sameSite: 'none',
        httpOnly: true,}
      );
      // huỷ session sau login
      await deleteNonce(c.env, sessionId);

      return c.json({ ok: true });
      
    } catch (e) {
      err("Wallet connect failed:", e);
      const { errorResponse, status } = handleError(e, "Wallet connection failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });

  // logout
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
      return c.json({ id: user.id, identifier: user.identifier, address: user.address }, 200);
    } catch (e: any) {
      const { errorResponse } = handleError(e, "Not authenticated");
      return c.json(errorResponse, 401);
    }
  });

  // --- DATA ENDPOINTS ---
  routes.get("/data", async (c) => {
    try {
      const user = requireAuth(c);
      const { key } = await parseBody(c, GetDataRequestSchema);      
      const userDO = getUserDO(c, user.identifier);

      const result = await userDO.get(key);
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
      return c.json({ ok: true, user: { id: user.id, identifier: user.identifier, address: user.address } });
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