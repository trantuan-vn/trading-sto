import { Hono } from 'hono';
import { getCookie } from 'hono/cookie'  
import { handleError, parseBody, getIPAndUserAgent, getSessionIdHash } from '../../shared/utils';

import { requireAuth } from './authMiddleware';
import { createApplicationService } from './application';
import { OTPRequestSchema, OTPVerificationSchema, OAuthCallbackSchema, SIWEAuthSchema } from './domain';
import { setCookieWithOption, clearAuthCookies, normalizeOAuthIdentifier } from './utils';
import { AUTH_CONSTANTS } from './constants';

export function createAuthRoutes(bindingName: string) {
  const routes = new Hono<{ Bindings: Env }>();
  // I. OAUTH
  routes.get('/oauth/:provider/url', async (c) => {

    try {
      const provider = c.req.param('provider') as 'google' | 'apple' | 'facebook' | 'github' | 'twitter';

      if (!provider) {
        throw new Error('Missing OAuth provider');
      }
      
      if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
        throw new Error(`Unsupported OAuth provider: ${provider}`);
      }

      const request = c.req.raw;
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }
      const sessionId = getSessionIdHash(ipAddress, userAgent, c.env.ENCRYPTION_SECRET);

      const applicationService = createApplicationService(c, bindingName);
      const authUrl = await applicationService.getAuthUrlUseCase(provider, sessionId);

      return c.json({ url: authUrl });

    } catch (e) {
      const { errorResponse, status } = handleError(e, "Failed to get OAuth URL");
      return c.json(errorResponse, status);
    }
  });

  routes.get('/oauth/:provider/callback', async (c) => {

    try {
      // Origin check
      const origin = c.req.header('origin') || c.req.header('referer');
      if (!origin || !origin.startsWith(c.env.FRONTEND_URL)) {
        throw new Error('Invalid origin');
      }

      const request = c.req.raw;
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }
      const sessionId = getSessionIdHash(ipAddress, userAgent, c.env.ENCRYPTION_SECRET);

      const provider = c.req.param('provider') as 'google' | 'apple' | 'facebook' | 'github' | 'twitter';
      // Validate provider
      if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
        throw new Error(`Unsupported OAuth provider: ${provider}`);
      }
      
      // Check for OAuth errors
      const error = c.req.query('error');
      if (error) {
        throw new Error(`OAuth error: ${error}`);
      }

      const { code, state } = OAuthCallbackSchema.parse(c.req.query());

      // Validate code
      if (!code) {
        throw new Error('Missing OAuth code');
      }

      // Validate state
      if (!state) {
        throw new Error('Missing OAuth state');
      }

      const applicationService = createApplicationService(c, bindingName);

      // Exchange code for tokens
      const validatedUserInfo = await applicationService.exchangeOAuthCodeUseCase(provider, sessionId, state, code);
            
      // Normalize identifier based on provider
      const identifier = normalizeOAuthIdentifier(provider, validatedUserInfo);
      
      const { token, refreshToken } = await applicationService.connectOAuthUseCase(sessionId, identifier, ipAddress, userAgent);

      setCookieWithOption(c, "sessionId", token, AUTH_CONSTANTS.SESSION_EXPIRY);
      setCookieWithOption(c, "token", token, AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY);
      setCookieWithOption(c, "refreshToken", refreshToken, AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);

      const redirectUrl = `${c.env.FRONTEND_URL}`;

      return c.redirect(redirectUrl);

    } catch (e) {
      const { errorResponse, status } = handleError(e, "OAuth callback failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });  
  
  // II. OTP
  routes.post('/otp/request', async (c) => {
    try {
      const { identifier } = await parseBody(c, OTPRequestSchema);
      if (!identifier) {
        throw new Error('Missing identifier');
      }

      const request = c.req.raw;
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }
      const sessionId = getSessionIdHash(ipAddress, userAgent, c.env.ENCRYPTION_SECRET);

      const applicationService = createApplicationService(c, bindingName);
      await applicationService.getRequestOtpUseCase(identifier, sessionId);

      return c.json({ ok: true });
    }
    catch (e) {
      const { errorResponse, status } = handleError(e, "OTP request failed");
      return c.json(errorResponse, status);
    }
  });
  
  routes.post('/otp/verify', async (c) => {
    try {
      // Origin check
      const origin = c.req.header('origin') || c.req.header('referer');
      if (!origin || !origin.startsWith(c.env.FRONTEND_URL)) {
        throw new Error('Invalid origin');
      }

      const { identifier, otp } = await parseBody(c, OTPVerificationSchema);
      if (!identifier || !otp) {
        throw new Error('Missing identifier or OTP');
      }
      const request = c.req.raw;
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }
      const sessionId = getSessionIdHash(ipAddress, userAgent, c.env.ENCRYPTION_SECRET);

      const applicationService = createApplicationService(c, bindingName);

      const { token, refreshToken } = await applicationService.verifyOtpUseCase(identifier, sessionId, otp, ipAddress, userAgent);

      setCookieWithOption(c, "sessionId", token, AUTH_CONSTANTS.SESSION_EXPIRY);
      setCookieWithOption(c, "token", token, AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY);
      setCookieWithOption(c, "refreshToken", refreshToken, AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);

      return c.json({ ok: true });
    }
    catch (e) {
      const { errorResponse, status } = handleError(e, "OTP verification failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });
  
  // III. Wallet
  routes.get('/wallet/nonce', async (c) => {
    try {
      const request = c.req.raw;
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }
      const sessionId = getSessionIdHash(ipAddress, userAgent, c.env.ENCRYPTION_SECRET);
      const applicationService = createApplicationService(c, bindingName);
      const nonce= await applicationService.generateNonceUseCase(sessionId);

      return c.json({ nonce: nonce });
    } catch (e) {
      const { errorResponse, status } = handleError(e, "Nonce request failed");
      return c.json(errorResponse, status);
    }
  });

  routes.post('/wallet/connect', async (c) => {
    try {
      // Origin check
      const origin = c.req.header('origin') || c.req.header('referer');

      if (!origin || !origin.startsWith(c.env.FRONTEND_URL)) {
        throw new Error('Invalid origin');
      }

      const { message, signature } = await parseBody(c, SIWEAuthSchema);
      if (!message || !signature) {
        throw new Error('Missing message or signature');
      }

      const request = c.req.raw;
      const { ipAddress, userAgent } = getIPAndUserAgent(request);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }
      const sessionId = getSessionIdHash(ipAddress, userAgent, c.env.ENCRYPTION_SECRET);

      const applicationService = createApplicationService(c, bindingName);
      const fields = await applicationService.verifySignatureUseCase(sessionId, message, signature);

      // Tạo/cập nhật user
      const address = fields.address.toLowerCase();

      const { token, refreshToken } = await applicationService.connectWalletUseCase(sessionId, address, ipAddress, userAgent);

      setCookieWithOption(c, "sessionId", token, AUTH_CONSTANTS.SESSION_EXPIRY);
      setCookieWithOption(c, "token", token, AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY);
      setCookieWithOption(c, "refreshToken", refreshToken, AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);      

      return c.json({ ok: true });
      
    } catch (e) {
      const { errorResponse, status } = handleError(e, "Wallet connection failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });
  
  // IV. Profile
  routes.post('/profile/logout', async (c) => {
    try {
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) {
        throw new Error('Session not found');
      }
      const user = requireAuth(c);
      const applicationService = createApplicationService(c, bindingName);
      await applicationService.logoutUseCase(user.identifier, sessionId);
      clearAuthCookies(c);
      
      return c.json({ ok: true });
    } catch (e) {
      const { errorResponse } = handleError(e, "Logout failed");
      return c.json(errorResponse, 401);
    }
  });
  
  routes.post('/profile/logoutAll', async (c) => {
    try {
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) {
        throw new Error('Session not found');
      }
      const user = requireAuth(c);
      const applicationService = createApplicationService(c, bindingName);
      await applicationService.logoutAllUseCase(user.identifier, sessionId);
      clearAuthCookies(c);
      return c.json({ ok: true });
    } catch (e) {
      const { errorResponse } = handleError(e, "Logout failed");
      return c.json(errorResponse, 401);
    }
  });

  routes.get('/profile/me', async (c) => {
    try {
      const user = requireAuth(c);
      if (!user) {
        throw new Error('User not found');
      }
      return c.json({ id: user.id, identifier: user.identifier, address: user.address }, 200);
    } catch (e: any) {
      const { errorResponse } = handleError(e, "Get user info failed");
      return c.json(errorResponse, 401);
    }
  });  

  return routes;
}
