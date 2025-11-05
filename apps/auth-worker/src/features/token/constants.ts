import { EKYC_SERVICE_PERMISSIONS } from '../ekyc/constant';

const API_TOKEN_CONSTANTS = {
  TOKEN_PREFIX: 'utk_',
} as const;

// Security configuration
const SECURITY_CONFIG = {
  MAX_TOKEN_LENGTH: 1024,
  TOKEN_TIMEOUT_MS: 5000, // 5 seconds timeout for token validation
} as const;

// Constants for KV service
const AUTH_CONSTANTS = {
  RATE_LIMIT_WINDOW: 1 * 60 * 1000, // 1 minutes
  RATE_LIMIT_MAX: 5,
};

export { API_TOKEN_CONSTANTS, SECURITY_CONFIG, AUTH_CONSTANTS };

export const DEFAULT_PERMISSIONS = [
  ...EKYC_SERVICE_PERMISSIONS,
  // Add more permissions here
  
];