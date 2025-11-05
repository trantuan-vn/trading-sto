import { Context, Next } from 'hono';
import { createTokenApplicationService } from './application.js';
import { handleError } from '../../shared/utils';
import { SECURITY_CONFIG } from './constants';
import { isValidAuthHeader, isValidTokenFormat, sanitizeTokenData, 
  validatePermissions, getClientIP, addSecurityHeaders, isValidTokenStructure, isValidClientId } from './utils';

export function createTokenValidationMiddleware(bindingName: string) {
  return async (c: Context, next: Next) => {
    try {
      // Luôn xóa user cũ trước khi xác thực lại
      c.set('tokenData', undefined);
      
      const clientId = c.req.header('X-Client-ID') || c.req.query('client_id');
      
      if (!clientId) {
        throw new Error('Missing client ID');
      }

      if (!isValidClientId(clientId)) {
        throw new Error('Invalid client ID');
      }

      // Lấy token từ header Authorization Bearer
      const authHeader = c.req.header('Authorization');
      
      if (authHeader) {
        // 2. Input Validation - Protection against injection attacks
        if (!isValidAuthHeader(authHeader)) {
          throw new Error('Invalid authorization header format');
        }

        const token = authHeader.substring(7); // Lấy phần sau "Bearer "
        
        // 3. Token Length Validation - Prevention of DoS attacks
        if (!token || token.length > SECURITY_CONFIG.MAX_TOKEN_LENGTH) {
          throw new Error('Invalid token');
        }

        // 4. Token Format Validation - Basic sanitization
        if (!isValidTokenFormat(token)) {
          throw new Error('Invalid token format');
        }

        const applicationService = createTokenApplicationService(c, bindingName);
        
        // 5. Timeout Protection - Prevention of DoS attacks
        const validationPromise = applicationService.validateApiTokenUseCase(clientId, token);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Token validation timeout')), SECURITY_CONFIG.TOKEN_TIMEOUT_MS)
        );

        const validationResult = await Promise.race([validationPromise, timeoutPromise]) as any;
        
        if (!validationResult.isValid) {
          // Ghi nhận lần thất bại vào ratelimit (thông qua việc gọi checkRateLimit ở lần tiếp theo)
          throw new Error(validationResult.error || 'Invalid token');
        }

        // 6. Token Data Sanitization
        const sanitizedTokenData = sanitizeTokenData(validationResult.token);
        c.set('tokenData', sanitizedTokenData);
        
        // Rate limit sẽ tự động reset sau khi hết thời gian window
      }
      
      await next();
    } catch (error) {
      const { errorResponse, status } = handleError(error, 'Failed to validate token');
      // 7. Security Headers
      addSecurityHeaders(c);
      return c.json(errorResponse, status);
    }
  };
}

// Permission Validation
export function requirePermissions(c: Context, permissions: string[]) {
    const token = c.get('tokenData');
    
    if (!token) {
        throw new Error('Not authenticated');
    }

    // 8. Enhanced Token Validation
    if (!isValidTokenStructure(token)) {
        throw new Error('Invalid token structure');
    }

    // 9. Permission Validation
    validatePermissions(token, permissions);
    
    return token;
}

// Additional security middleware for comprehensive protection
export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();
    
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Content-Security-Policy', "default-src 'self'");
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=()');
  };
}

// Logging middleware for security monitoring
export function securityLoggingMiddleware() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    
    await next();
    
    const processingTime = Date.now() - startTime;
    const tokenData = c.get('tokenData');

    // Log security events
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      processingTime,
      userId: tokenData?.id || 'anonymous',
      clientIP: getClientIP(c),
      userAgent: c.req.header('user-agent'),
      event: 'api_request'
    };
    console.log(JSON.stringify(logEntry));
  };
}