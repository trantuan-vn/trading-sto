// Error Messages
export const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid credentials',
  INVALID_OTP: 'Invalid or expired OTP',
  RATE_LIMIT_EXCEEDED: 'Too many requests',
  USER_NOT_FOUND: 'User not found',
  ORGANIZATION_NOT_FOUND: 'Organization not found',
  NOT_AUTHENTICATED: 'Not authenticated',
  NOT_AUTHORIZED: 'Not authorized'
};

// Authentication Constants
export const AUTH_CONSTANTS = {
  RESERVED_PREFIX: "__",
  RATE_LIMIT_MAX: 5,
  RATE_LIMIT_WINDOW: 60_000, // 1 minute
  ACCESS_TOKEN_EXPIRY: 3 * 60, // 3 minutes
  REFRESH_TOKEN_EXPIRY: 15 * 60, // 15 minutes
  SESSION_EXPIRY: 30 * 60, // 30 minutes
  NONCE_EXPIRY: 5 * 60 // 5 minutes
};