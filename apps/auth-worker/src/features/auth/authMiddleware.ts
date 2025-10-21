import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { clearAuthCookies, setCookieWithOption } from './utils.js';
import { createApplicationService } from './application';

export function createAuthMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    
    try {
      // Luôn xóa user cũ trước khi xác thực lại
      c.set('user', undefined)

      const token = getCookie(c, 'token') 
      const refreshToken = getCookie(c, 'refreshToken')
      if (!refreshToken) {
        clearAuthCookies(c)
      }
      else {
        const applicationService = createApplicationService(c, bindingName);

        if (!token) {
          const result = await applicationService.refreshTokenUseCase(refreshToken);
          if (result.ok) {
            setCookieWithOption(c, 'token', result.token, 10 * 60);
            c.set('user', result.user)
          }
          else {
            clearAuthCookies(c)
          }      
        }
        else {
          const result = await applicationService.verifyTokenUseCase(token, refreshToken);
          if (result.ok) {
            c.set('user', result.user)
          }
          else {
            clearAuthCookies(c)
          }        
        }        
      }
    }
    catch (e) {
      console.error(e)
    }

    await next()
  }
}

export function requireAuth(c: Context) {
  const user = c.get('user');
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user;
}
