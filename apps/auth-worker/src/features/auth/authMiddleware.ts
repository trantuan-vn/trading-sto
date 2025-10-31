import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { clearAuthCookies, setCookieWithOption } from './utils.js';
import { createApplicationService } from './application';
import { handleError } from '../../shared/utils';
import { AUTH_CONSTANTS } from './constants';

export function createAuthMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    try {
      // Reset user context
      c.set('user', undefined);
      
      const sessionId = getCookie(c, 'sessionId');
      const token = getCookie(c, 'token');
      const refreshToken = getCookie(c, 'refreshToken');
      
      // If no refresh token, clear cookies and continue
      if (!refreshToken) {
        clearAuthCookies(c);
        return await next();
      }
      
      await processAuthentication(c, bindingName, sessionId, token, refreshToken);
    } catch (error) {
      handleError(error, 'Failed to authenticate user');
      clearAuthCookies(c);
    }
    
    await next();
  };
}

async function processAuthentication(
  c: Context,
  bindingName: string,
  sessionId: string | undefined,
  token: string | undefined,
  refreshToken: string
): Promise<void> {
  const applicationService = createApplicationService(c, bindingName);
  
  try {
    if (!token) {
      // Token missing, try to refresh
      await handleTokenRefresh(c, applicationService, sessionId, refreshToken);
    } else {
      // Token exists, verify it
      await handleTokenVerification(c, applicationService, sessionId, token, refreshToken);
    }
  } catch (error) {
    throw error;
  }
}

async function handleTokenRefresh(
  c: Context,
  applicationService: any,
  sessionId: string | undefined,
  refreshToken: string
): Promise<void> {
  if (!sessionId) {
    clearAuthCookies(c);
    return;
  }
  
  const result = await applicationService.refreshTokenUseCase(sessionId, refreshToken);
  if (result.ok) {
    setCookieWithOption(c, 'token', result.token, AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY);
    setCookieWithOption(c, 'refreshToken', result.refreshToken, AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);
    c.set('user', result.user);
  } else {
    throw new Error('Invalid refresh token');
  }
}

async function handleTokenVerification(
  c: Context,
  applicationService: any,
  sessionId: string | undefined,
  token: string,
  refreshToken: string
): Promise<void> {
  if (!sessionId) {
    throw new Error('Session not found');
  }
  
  const result = await applicationService.verifyTokenUseCase(sessionId, token, refreshToken);
  if (result.ok) {
    c.set('user', result.user);
  } else {
    await handleTokenRefresh(c, applicationService, sessionId, refreshToken);
  }
}

export function requireAuth(c: Context) {
  const user = c.get('user');
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user;
}