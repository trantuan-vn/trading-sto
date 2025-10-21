import { z } from 'zod';

// API Token Schemas
export const ApiTokenSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string().min(1).max(100),
  token: z.string(), // The actual API token
  tokenHash: z.string(), // Hashed version for storage
  permissions: z.array(z.string()).default([]),
  lastUsed: z.string().optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
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

export const ApiTokenUsageSchema = z.object({
  tokenId: z.string(),
  endpoint: z.string(),
  timestamp: z.string(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
});

// Types
export type ApiToken = z.infer<typeof ApiTokenSchema>;
export type CreateApiToken = z.infer<typeof CreateApiTokenSchema>;
export type RevokeApiToken = z.infer<typeof RevokeApiTokenSchema>;
export type ValidateApiToken = z.infer<typeof ValidateApiTokenSchema>;
export type ApiTokenUsage = z.infer<typeof ApiTokenUsageSchema>;

// Domain Interfaces
export interface IApiTokenService {
  createApiToken(identifier: string, request: CreateApiToken): Promise<{ apiToken: ApiToken; rawToken: string }>;
  revokeApiToken(identifier: string, tokenId: string): Promise<void>;
  revokeAllApiTokens(identifier: string): Promise<void>;
  getUserApiTokens(identifier: string): Promise<ApiToken[]>;

  validateApiToken(token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }>;
  recordTokenUsage(usage: ApiTokenUsage): Promise<void>;
  getTokenUsage(tokenId: string, days?: number): Promise<ApiTokenUsage[]>;
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