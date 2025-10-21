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
  AUTH_DATA_KEY: "__user",
  RATE_LIMIT_KEY: "__rl",
  RATE_LIMIT_MAX: 5,
  RATE_LIMIT_WINDOW: 60_000, // 1 minute
  OTP_EXPIRY: 10 * 60 * 1000, // 10 minutes
  ACCESS_TOKEN_EXPIRY: 15 * 60, // 15 minutes
  REFRESH_TOKEN_EXPIRY: 7 * 24 * 60 * 60, // 7 days
  NONCE_EXPIRY: 5 * 60 // 5 minutes
};