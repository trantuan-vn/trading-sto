import { Hono } from 'hono';
import { getCookie } from 'hono/cookie'  
import { handleError, parseBody } from '../../shared/utils';

import { requireAuth } from './authMiddleware';
import { createApplicationService } from './application';
import { OTPRequestSchema, OTPVerificationSchema, OAuthCallbackSchema, SIWEAuthSchema } from './domain';
import { setCookieWithOption, clearAuthCookies, normalizeOAuthIdentifier} from './utils';

export function createAuthRoutes(bindingName: string) {
  const routes = new Hono<{ Bindings: Env }>();

  routes.get('/oauth/:provider/url', async (c) => {

    try {
      const provider = c.req.param('provider') as 'google' | 'apple' | 'facebook' | 'github' | 'twitter';
      
      if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
        return c.json({ error: 'Invalid OAuth provider' }, 400);
      }

      const applicationService = createApplicationService(c, bindingName);
      const { sessionId, authUrl } = await applicationService.getAuthUrlUseCase(provider);

      setCookieWithOption(c, 'sessionId', sessionId, 5*60);

      return c.json({ url: authUrl });

    } catch (e) {
      const { errorResponse, status } = handleError(e, "Failed to get OAuth URL");
      return c.json(errorResponse, status);
    }
  });

  routes.get('/oauth/:provider/callback', async (c) => {

    try {
      const provider = c.req.param('provider') as 'google' | 'apple' | 'facebook' | 'github' | 'twitter';
      // Validate provider
      if (!['google', 'apple', 'facebook', 'github', 'twitter'].includes(provider)) {
        const { errorResponse, status } = handleError(new Error('Invalid OAuth provider'), `Validate provider error for ${provider}`);
        return c.json(errorResponse, status);
      }
      
      // Check for OAuth errors
      const error = c.req.query('error');
      if (error) {
        const { errorResponse, status } = handleError(new Error(c.req.query('error_description') || error), `Check for OAuth error for ${provider}`);
        return c.json(errorResponse, status);
      }

      const { code, state } = OAuthCallbackSchema.parse(c.req.query());

      // Validate code
      if (!code) {
        const { errorResponse, status } = handleError(new Error('Invalid OAuth code'), `Validate code error for ${provider}`);
        return c.json(errorResponse, status);
      }

      // Validate state
      if (!state) {
        const { errorResponse, status } = handleError(new Error('Invalid OAuth state'), `Validate state error for ${provider}`);
        return c.json(errorResponse, status);
      }

      // Validate sessionId
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) {
        const { errorResponse, status } = handleError(new Error('Invalid OAuth state'), `Validate state error for ${provider}`);
        return c.json(errorResponse, status);
      }
      const applicationService = createApplicationService(c, bindingName);

      // Exchange code for tokens
      const { tokenData, validatedUserInfo } = await applicationService.exchangeOAuthCodeUseCase(provider, sessionId, state, code);
            
      // Normalize identifier based on provider
      const identifier = normalizeOAuthIdentifier(provider, validatedUserInfo);
      
      const { token, refreshToken } = await applicationService.connectOAuthUseCase(provider, identifier, tokenData, validatedUserInfo);

      setCookieWithOption(c, "token", token, 15*60);
      setCookieWithOption(c, "refreshToken", refreshToken, 24*60*60);

      const redirectUrl = `${c.env.FRONTEND_URL}`;

      return c.redirect(redirectUrl);

    } catch (e) {
      const { errorResponse, status } = handleError(e, "OAuth callback failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });  
  
  // ---  email/phone AUTH ENDPOINTS ---
  routes.post('/otp/request', async (c) => {
    try {
      const { identifier } = await parseBody(c, OTPRequestSchema);
      if (!identifier) {
        const { errorResponse, status } = handleError(new Error('Invalid identifier'), "Validate identifier error");
        return c.json(errorResponse, status);
      }
      const applicationService = createApplicationService(c, bindingName);
      const  sessionId = await applicationService.getRequestOtpUseCase(identifier);

      setCookieWithOption(c, 'sessionId', sessionId, 5*60);

      return c.json({ ok: true });
    }
    catch (e) {
      const { errorResponse, status } = handleError(e, "OTP request failed");
      return c.json(errorResponse, status);
    }
  });
  
  routes.post('/otp/verify', async (c) => {
    try {
      const { identifier, otp } = await parseBody(c, OTPVerificationSchema);
      if (!identifier || !otp) {
        const { errorResponse, status } = handleError(new Error('Invalid identifier or otp'), "Validate identifier or otp error");
        return c.json(errorResponse, status);
      }
      // Validate sessionId
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) {
        const { errorResponse, status } = handleError(new Error('Invalid sessionId'), "Validate sessionId error");
        return c.json(errorResponse, status);
      }
      const applicationService = createApplicationService(c, bindingName);
      const { token, refreshToken } = await applicationService.verifyOtpUseCase(identifier, sessionId, otp);
      setCookieWithOption(c, "token", token, 10*60);
      setCookieWithOption(c, "refreshToken", refreshToken, 24*60*60);
      return c.json({ ok: true });
    }
    catch (e) {
      const { errorResponse, status } = handleError(e, "OTP verification failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });

  // ---  wallet endpoint để lấy nonce/connect ---
  routes.get('/wallet/nonce', async (c) => {
    try {
      const applicationService = createApplicationService(c, bindingName);
      const { nonce, sessionId } = await applicationService.generateNonceUseCase();
      // Set cookie session
      setCookieWithOption(c, "sessionId", sessionId, 5*60);
      return c.json({ nonce: nonce });
    } catch (e) {
      const { errorResponse, status } = handleError(e, "OTP request failed");
      return c.json(errorResponse, status);
    }
  });


  routes.post('/wallet/connect', async (c) => {
    try {
      // Origin check
      const origin = c.req.header('origin') || c.req.header('referer');

      if (!origin || !origin.startsWith(c.env.FRONTEND_URL)) {
        return c.json({ error: 'Bad origin' }, 403);
      }

      const { message, signature } = await parseBody(c, SIWEAuthSchema);
      if (!message || !signature) {
        return c.json({ error: 'Missing message or signature' }, 400);
      }

      // Lấy sessionId từ cookie
      const sessionId = getCookie(c, 'sessionId');
      if (!sessionId) {
        return c.json({ error: 'Session not found' }, 400);
      }

      const applicationService = createApplicationService(c, bindingName);
      const fields = await applicationService.verifySignatureUseCase(sessionId, message, signature);

      // Tạo/cập nhật user
      const address = fields.address.toLowerCase();

      const { token, refreshToken } = await applicationService.connectWalletUseCase(address);

      setCookieWithOption(c, "token", token, 10*60);
      setCookieWithOption(c, "refreshToken", refreshToken, 24*60*60);      

      return c.json({ ok: true });
      
    } catch (e) {
      const { errorResponse, status } = handleError(e, "Wallet connection failed");
      clearAuthCookies(c);
      return c.json(errorResponse, status);
    }
  });

  // logout
  routes.post('/profile/logout', async (c) => {
    try {
      const refreshToken = getCookie(c, 'refreshToken');
      if (!refreshToken) {
        throw new Error('Refresh token not found');
      }
      const user = requireAuth(c);
      const applicationService = createApplicationService(c, bindingName);
      await applicationService.logoutUseCase(user.identifier, refreshToken);
      clearAuthCookies(c);
      
      return c.json({ ok: true });
    } catch (e) {
      const { errorResponse } = handleError(e, "Logout failed");
      return c.json(errorResponse, 401);
    }
  });
  // logout all
  routes.post('/profile/logoutAll', async (c) => {
    try {
      const refreshToken = getCookie(c, 'refreshToken');
      if (!refreshToken) {
        throw new Error('Refresh token not found');
      }
      const user = requireAuth(c);
      const applicationService = createApplicationService(c, bindingName);
      await applicationService.logoutAllUseCase(user.identifier);
      clearAuthCookies(c);
      return c.json({ ok: true });
    } catch (e) {
      const { errorResponse } = handleError(e, "Logout failed");
      return c.json(errorResponse, 401);
    }
  });

  // get user
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
