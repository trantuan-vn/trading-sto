import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { createTokenApplicationService } from './application.js';

export function createTokenValidationMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    try {
      // Luôn xóa user cũ trước khi xác thực lại
      c.set('tokenData', undefined)
      // Lấy token từ header Authorization Bearer
      const authHeader = c.req.header('Authorization');
            
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7); // Lấy phần sau "Bearer "
        if (!token) {
          throw new Error('Missing token');
        }
        const applicationService = createTokenApplicationService(c, bindingName);
        const validationResult = await applicationService.validateApiTokenUseCase({ token }) as any;        
        if (!validationResult.isValid) {
            return c.json({ error: 'Invalid token' }, 401);
        }
        c.set('tokenData', validationResult.token);
      }
      await next();
    } catch (error) {
      return c.json({ 
        error: error instanceof Error ? error.message : 'Token validation failed' 
      }, 401);
    }
  };
}

export function requireApiAuth(c: Context) {
    const token = c.get('tokenData');
    if (!token) {
        throw new Error('Not authenticated');
    }
    return token;
}

export function requirePermissions(c: Context, permissions: string[]) {
    const token = requireApiAuth(c);
    // Kiểm tra token có tồn tại và có thuộc tính permissions không
    if (!token || typeof token !== 'object') {
        throw new Error('Invalid token data');
    }
    // Kiểm tra token có quyền admin:all
    const hasAdminAll = token.permissions && 
                        Array.isArray(token.permissions) && 
                        token.permissions.includes('admin:all');
    if (hasAdminAll) {
        return token; // Admin có toàn quyền
    }
    // Kiểm tra permissions có tồn tại và là mảng
    if (!token.permissions || !Array.isArray(token.permissions)) {
        throw new Error('Insufficient permissions - no permissions found');
    }
    // Kiểm tra tất cả permissions được yêu cầu
    const hasAllPermissions = permissions.every(permission => 
        token.permissions.includes(permission)
    );
    if (!hasAllPermissions) {
        throw new Error(`Insufficient permissions - required: [${permissions.join(', ')}]`);
    }
    return token;
}