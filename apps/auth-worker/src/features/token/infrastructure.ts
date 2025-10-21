import { handleError } from '../../shared/utils';
import { 
  IApiTokenService,
  ITokenGenerator,
  IPermissionService,
  ApiToken,
  CreateApiToken,
  ApiTokenUsage,
} from './domain';
import { API_TOKEN_CONSTANTS } from './constants';

export function createApiTokenService(storage: DurableObjectStorage, env: any): IApiTokenService {
  const tokenGenerator = createTokenGenerator(env);
  const permissionService = createPermissionService();

  return {
    // Token Management
    async createApiToken(identifier: string, request: CreateApiToken): Promise<{ apiToken: ApiToken; rawToken: string }> {
      try {
        const rawToken = tokenGenerator.generateToken();
        const tokenHash = await tokenGenerator.hashToken(rawToken);

        const expiresAt = request.expiresInDays 
          ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined;

        // Các quyền mặc định cho mỗi token
        const defaultPermissions = permissionService.createDefaultPermissions();

        // Kết hợp quyền từ request (nếu có) với quyền mặc định
        const finalPermissions = request.permissions 
          ? [...new Set([...defaultPermissions, ...request.permissions])] 
          : defaultPermissions;

        const apiToken: ApiToken = {
          id: crypto.randomUUID(),
          identifier,
          name: request.name,
          token: rawToken,
          tokenHash,
          permissions: finalPermissions, // Sử dụng quyền đã kết hợp
          expiresAt,
          createdAt: new Date().toISOString(),
          isActive: true,
        };

        const tokens = await getUserTokens(storage, identifier);
        tokens.push(apiToken);
        await storage.put(`api_tokens_${identifier}`, tokens);

        return { apiToken, rawToken };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to create API token');
        throw { errorResponse, status };
      }
    },
    async getUserApiTokens(identifier: string): Promise<ApiToken[]> {
      try {
        const tokens = await getUserTokens(storage, identifier);
        
        return tokens.map(token => ({
          ...token,
          token: '***'
        }));
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to get user API tokens');
        throw { errorResponse, status };
      }
    },
    async revokeApiToken(identifier: string, tokenId: string): Promise<void> {
      try {
        const tokens = await getUserTokens(storage, identifier);
        const tokenIndex = tokens.findIndex(t => t.id === tokenId);
        
        if (tokenIndex === -1) {
          throw new Error('Token not found');
        }

        tokens[tokenIndex].isActive = false;
        await storage.put(`api_tokens_${identifier}`, tokens);
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to revoke API token');
        throw { errorResponse, status };
      }
    },
    async revokeAllApiTokens(identifier: string): Promise<void> {
      try {
        const tokens = await getUserTokens(storage, identifier);
        
        for (const token of tokens) {
          token.isActive = false;
        }
        await storage.put(`api_tokens_${identifier}`, tokens);

      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to revoke all API tokens');
        throw { errorResponse, status };
      }
    },

    async validateApiToken(token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }> {
      try {
        const allTokens = await getAllTokens(storage);
        
        for (const apiToken of allTokens) {
          const isValid = await tokenGenerator.verifyToken(token, apiToken.tokenHash);
          
          if (isValid) {
            if (!apiToken.isActive) {
              return { isValid: false, error: 'Token revoked' };
            }

            if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
              return { isValid: false, error: 'Token expired' };
            }

            await updateLastUsed(storage, apiToken.id);
            
            return { isValid: true, token: apiToken };
          }
        }

        return { isValid: false, error: 'Invalid token' };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Token validation failed');
        return { isValid: false, error: errorResponse.error };
      }
    },

    async recordTokenUsage(usage: ApiTokenUsage): Promise<void> {
      try {
        const usages = await storage.get<ApiTokenUsage[]>(`token_usage_${usage.tokenId}`) || [];
        usages.push(usage);
        
        if (usages.length > API_TOKEN_CONSTANTS.MAX_USAGE_RECORDS) {
          usages.splice(0, usages.length - API_TOKEN_CONSTANTS.MAX_USAGE_RECORDS);
        }
        
        await storage.put(`token_usage_${usage.tokenId}`, usages);
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to record token usage');
        throw { errorResponse, status };
      }
    },

    async getTokenUsage(tokenId: string, days: number = 30): Promise<ApiTokenUsage[]> {
      try {
        const usages = await storage.get<ApiTokenUsage[]>(`token_usage_${tokenId}`) || [];
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return usages.filter(usage => new Date(usage.timestamp) >= cutoffDate);
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to get token usage');
        throw { errorResponse, status };
      }
    }
  };
}

export function createTokenGenerator(env: any): ITokenGenerator {
  return {
    generateToken(): string {
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const token = btoa(String.fromCharCode(...randomBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      
      return `utk_${token}`;
    },

    async hashToken(token: string): Promise<string> {
      const encoder = new TextEncoder();
      const data = encoder.encode(token + env.JWT_SECRET);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async verifyToken(token: string, hash: string): Promise<boolean> {
      const computedHash = await this.hashToken(token);
      return computedHash === hash;
    }
  };
}

export function createPermissionService(): IPermissionService {
  const availablePermissions = [
    'read:profile',
    'write:profile',
    'read:tokens',
    'write:tokens',
    'admin:all'
  ];

  return {
    validatePermissions(requiredPermissions: string[], userPermissions: string[]): boolean {
      if (userPermissions.includes('admin:all')) {
        return true;
      }

      return requiredPermissions.every(permission => 
        userPermissions.includes(permission)
      );
    },

    getAvailablePermissions(): string[] {
      return [...availablePermissions];
    },
    createDefaultPermissions(): string[] {
      return ['read:profile'];
    }
  };
}

// Private helper functions
async function getUserTokens(storage: DurableObjectStorage, userId: string): Promise<ApiToken[]> {
  return await storage.get<ApiToken[]>(`api_tokens_${userId}`) || [];
}

async function getAllTokens(storage: DurableObjectStorage): Promise<ApiToken[]> {
  const keys = await storage.list({ prefix: 'api_tokens_' });
  const allTokens: ApiToken[] = [];
  
  for (const value of keys.values()) {
    if (Array.isArray(value)) {
      allTokens.push(...value);
    }
  }
  
  return allTokens;
}

async function updateLastUsed(storage: DurableObjectStorage, tokenId: string): Promise<void> {
  try {
    const allTokens = await getAllTokens(storage);
    let updated = false;
    
    for (const token of allTokens) {
      if (token.id === tokenId) {
        token.lastUsed = new Date().toISOString();
        updated = true;
        break;
      }
    }
    
    if (updated) {
      const userTokensMap = new Map<string, ApiToken[]>();
      
      for (const token of allTokens) {
        if (!userTokensMap.has(token.identifier)) {
          userTokensMap.set(token.identifier, []);
        }
        userTokensMap.get(token.identifier)!.push(token);
      }
      
      for (const [userId, tokens] of userTokensMap) {
        await storage.put(`api_tokens_${userId}`, tokens);
      }
    }
  } catch (error) {
    console.error('Failed to update last used timestamp:', error);
  }
}