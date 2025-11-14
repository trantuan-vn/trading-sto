import { z } from 'zod';

// API Token Schemas
export const ApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  identifier: z.string(),
  tokenHash: z.string(), // Hashed version for storage
  permissions: z.array(z.string()).default([]),
  expiresAt: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const CreateApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).optional().default([]),
  expiresInDays: z.number().min(1).max(365).optional().default(30),
});

export const RevokeApiTokenSchema = z.object({
  tokenId: z.string(),
});

export const ValidateApiTokenSchema = z.object({
  token: z.string(),
});


// Types
export type ApiToken = z.infer<typeof ApiTokenSchema>;
export type CreateApiToken = z.infer<typeof CreateApiTokenSchema>;
export type RevokeApiToken = z.infer<typeof RevokeApiTokenSchema>;
export type ValidateApiToken = z.infer<typeof ValidateApiTokenSchema>;

// Domain Interfaces
export interface IApiTokenService {
  createApiToken(identifier: string, request: CreateApiToken): Promise<{apiToken: any, rawToken: string}>;
  revokeApiToken(tokenId: string): Promise<void>;
  revokeAllApiTokens(): Promise<void>;
  getUserApiTokens(): Promise<any[]>;

  validateApiToken(token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }>;
}

export interface ITokenGenerator {
  generateToken(): string;
  hashToken(token: string): Promise<string>;
  verifyToken(token: string, hash: string): Promise<boolean>;
}

export interface IPermissionService {
  validatePermissions(requiredPermissions: string[], userPermissions: string[]): boolean;
  getAvailablePermissions(): string[];
  createDefaultPermissions(): string[];
}

export interface IKvService {
  checkRateLimit(sessionId: string): Promise<void>;
}