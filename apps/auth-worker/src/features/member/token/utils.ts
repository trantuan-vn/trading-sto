import { Context } from 'hono';
// Security utility functions

function isValidAuthHeader(authHeader: string): boolean {
  const bearerPattern = /^Bearer [A-Za-z0-9\-_.]+$/;
  return bearerPattern.test(authHeader);
}

function isValidTokenFormat(token: string): boolean {
  // Basic JWT format validation (adjust based on your token format)
  const jwtPattern = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;
  const apiKeyPattern = /^[A-Za-z0-9\-_]{16,}$/;
  
  return jwtPattern.test(token) || apiKeyPattern.test(token);
}

function sanitizeTokenData(tokenData: any): any {
  if (!tokenData || typeof tokenData !== 'object') {
    return tokenData;
  }

  // Remove sensitive information
  const { password, secret, privateKey, iat, exp, ...sanitized } = tokenData;
  
  // Ensure permissions is an array
  if (sanitized.permissions && !Array.isArray(sanitized.permissions)) {
    sanitized.permissions = [];
  }
  
  return sanitized;
}

function isValidTokenStructure(token: any): boolean {
  return token && 
         typeof token === 'object' && 
         Array.isArray(token.permissions) &&
         token.permissions.every((p: any) => typeof p === 'string');
}

function validatePermissions(token: any, requiredPermissions: string[]): void {
  // Validate required permissions format
  if (!Array.isArray(requiredPermissions) || 
      !requiredPermissions.every(p => typeof p === 'string')) {
    throw new Error('Invalid permissions requirement');
  }

  // Check for admin:all permission
  const hasAdminAll = token.permissions.includes('admin:all');
  if (hasAdminAll) {
    return;
  }

  // Check all required permissions
  const hasAllPermissions = requiredPermissions.every(permission => 
    token.permissions.includes(permission)
  );

  if (!hasAllPermissions) {
    throw new Error(`Insufficient permissions - required: [${requiredPermissions.join(', ')}]`);
  }
}

function addSecurityHeaders(c: Context): void {
  // Add security headers to prevent certain attacks
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  // Don't leak authentication information in headers
  c.header('WWW-Authenticate', 'Bearer');
}

function isValidClientId(clientId: string): boolean {
  if (!clientId || typeof clientId !== 'string') {
    return false;
  }
  
  // UUID format hoặc custom format của bạn
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const customIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
  
  return uuidPattern.test(clientId) || customIdPattern.test(clientId);
}

export {
  isValidAuthHeader,
  isValidTokenFormat,
  sanitizeTokenData,
  isValidTokenStructure,
  validatePermissions,
  addSecurityHeaders,
  isValidClientId
};