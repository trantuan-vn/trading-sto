import { Context } from 'hono';
import { getIdFromName, getIdFromString } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createApiTokenService } from './infrastructure';
import { 
  CreateApiToken,
  RevokeApiToken,
} from './domain';

interface ITokenApplicationService {
  // Token Management
  createApiTokenUseCase(identifier: string, request: CreateApiToken): Promise<{ apiToken: any; rawToken: string; warning?: string }>;
  revokeApiTokenUseCase(identifier: string, request: RevokeApiToken): Promise<{ success: boolean }>;
  revokeAllApiTokensUseCase(identifier: string): Promise<{ success: boolean }>;
  getUserApiTokensUseCase(identifier: string): Promise<{ tokens: any[] }>;
  // Token Validation
  validateApiTokenUseCase(clientId: string, token: string): Promise<{ isValid: boolean; token?: any; error?: string; permissions?: string[] }>;
}


export function createTokenApplicationService(c: Context, bindingName: string): ITokenApplicationService {
  return {
    // I. Token Management
    async createApiTokenUseCase(identifier: string, request: CreateApiToken): Promise<{ apiToken: any; rawToken: string; warning?: string }> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO);
      
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
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO);
      const tokens = await apiTokenService.getUserApiTokens();
      return { tokens };
    },

    async revokeApiTokenUseCase(identifier: string, request: RevokeApiToken): Promise<{ success: boolean }> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO);
      await apiTokenService.revokeApiToken(request.tokenId);
      return { success: true };
    },

    async revokeAllApiTokensUseCase(identifier: string): Promise<{ success: boolean }> {
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const apiTokenService = createApiTokenService(userDO);
      await apiTokenService.revokeAllApiTokens();
      return { success: true };
    },

    // II. Token Validation
    async validateApiTokenUseCase(clientId: string, token: string): Promise<{ isValid: boolean; token?: any; error?: string; permissions?: string[] }> {
      const userDO = getIdFromString<UserDO>(c, clientId, bindingName);
      const apiTokenService = createApiTokenService(userDO);      
      return await apiTokenService.validateApiToken(token);
    }
  };
}