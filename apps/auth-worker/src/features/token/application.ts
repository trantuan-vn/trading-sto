import { Context } from 'hono';
import { getDO } from '../../shared/utils';
import { UserDO } from '../../shared/infrastructure/UserDO';
import { createApiTokenService } from './infrastructure';
import { 
  CreateApiToken,
  RevokeApiToken,
  ValidateApiToken,
  ApiTokenUsage
} from './domain';

interface ITokenApplicationService {
  // Token Management
  createApiTokenUseCase(identifier: string, request: CreateApiToken): Promise<{ apiToken: any; rawToken: string; warning?: string }>;
  revokeApiTokenUseCase(identifier: string, request: RevokeApiToken): Promise<{ success: boolean }>;
  revokeAllApiTokensUseCase(userId: string): Promise<{ success: boolean }>;
  getUserApiTokensUseCase(identifier: string): Promise<{ tokens: any[] }>;
  // Token Validation
  validateApiTokenUseCase(request: ValidateApiToken): Promise<{ isValid: boolean; token?: any; error?: string; permissions?: string[] }>;
  // Token Usage & Analytics
  recordTokenUsageUseCase(identifier: string, usage: ApiTokenUsage): Promise<void>;
  getTokenUsageUseCase(identifier: string, tokenId: string, days?: number): Promise<{ usage: ApiTokenUsage[] }>;
}


export function createTokenApplicationService(c: Context, bindingName: string): ITokenApplicationService {
  return {
    // I. Token Management
    async createApiTokenUseCase(identifier: string, request: CreateApiToken): Promise<{ apiToken: any; rawToken: string; warning?: string }> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());
      
      const result = await apiTokenService.createApiToken(identifier, request);
      
      const response = {
        apiToken: {
          id: result.apiToken.id,
          name: result.apiToken.name,
          permissions: result.apiToken.permissions,
          expiresAt: result.apiToken.expiresAt,
          createdAt: result.apiToken.createdAt
        },
        rawToken: result.rawToken,
        warning: 'Store this token securely! It will not be shown again.'
      };

      return response;
    },
    async getUserApiTokensUseCase(identifier: string): Promise<{ tokens: any[] }> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());
      
      const tokens = await apiTokenService.getUserApiTokens(identifier);
      return { tokens };
    },

    async revokeApiTokenUseCase(identifier: string, request: RevokeApiToken): Promise<{ success: boolean }> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());
      await apiTokenService.revokeApiToken(identifier, request.tokenId);
      return { success: true };
    },

    async revokeAllApiTokensUseCase(identifier: string): Promise<{ success: boolean }> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());
      await apiTokenService.revokeAllApiTokens(identifier);
      return { success: true };
    },

    // II. Token Validation
    async validateApiTokenUseCase(request: ValidateApiToken): Promise<{ isValid: boolean; token?: any; error?: string; permissions?: string[] }> {
      const userDO = getDO<UserDO>(c, 'validation', bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());      
      return await apiTokenService.validateApiToken(request.token);
    },

    async recordTokenUsageUseCase(identifier: string, usage: ApiTokenUsage): Promise<void> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());
      
      await apiTokenService.recordTokenUsage(usage);
    },

    async getTokenUsageUseCase(identifier: string, tokenId: string, days?: number): Promise<{ usage: ApiTokenUsage[] }> {
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO.getStorage(), userDO.getEnv());
      const usage = await apiTokenService.getTokenUsage(tokenId, days);
      return { usage };
    }
  };
}