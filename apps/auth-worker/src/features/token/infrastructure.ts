import { handleError } from '../../shared/utils';
import { 
  IApiTokenService,
  ITokenGenerator,
  IPermissionService,
  ApiToken,
  CreateApiToken,
  ApiTokenUsage,
  ApiTokenSchema,
  ApiTokenUsageSchema,
} from './domain';
import { API_TOKEN_CONSTANTS } from './constants';
import { UserDO } from '../ws/infrastructure/UserDO';

// -----------------------------------------------------------------------------
// Main Factory
// -----------------------------------------------------------------------------
export function createApiTokenService(userDO: UserDO): IApiTokenService {
  const tokenGenerator = createTokenGenerator(userDO.getEnv());
  const permissionService = createPermissionService();

  // Use table-based abstraction from UserDO
  const tokenTable = userDO.table('api_tokens', ApiTokenSchema, { userScoped: true });
  const usageTable = userDO.table('token_usage', ApiTokenUsageSchema, { userScoped: true });

  return {
    // -------------------------------------------------------------------------
    // I. TOKEN MANAGEMENT
    // -------------------------------------------------------------------------
    async createApiToken(identifier: string, request: CreateApiToken): Promise<{ apiToken: ApiToken; rawToken: string }> {
      try {
        const rawToken = tokenGenerator.generateToken();
        const tokenHash = await tokenGenerator.hashToken(rawToken);

        const expiresAt = request.expiresInDays
          ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined;

        // Default + custom permissions
        const defaultPerms = permissionService.createDefaultPermissions();
        const mergedPerms = request.permissions
          ? [...new Set([...defaultPerms, ...request.permissions])]
          : defaultPerms;

        const apiToken: ApiToken = {
          id: crypto.randomUUID(),
          identifier,
          name: request.name,
          token: rawToken,
          tokenHash,
          permissions: mergedPerms,
          expiresAt,
          createdAt: new Date().toISOString(),
          isActive: true,
        };

        await tokenTable.create(apiToken);
        return { apiToken, rawToken };
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to create API token');
        throw { errorResponse, status };
      }
    },

    async getUserApiTokens(identifier: string): Promise<ApiToken[]> {
      try {
        const tokens = await tokenTable.where('identifier', '==', identifier).get();
        return tokens.map(t => ({ ...t, token: '***' }));
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to get API tokens');
        throw { errorResponse, status };
      }
    },

    async revokeApiToken(identifier: string, tokenId: string): Promise<void> {
      try {
        const token = await tokenTable.findById(tokenId);
        if (!token || token.identifier !== identifier) {
          throw new Error('Token not found');
        }
        await tokenTable.update(tokenId, { isActive: false });
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to revoke API token');
        throw { errorResponse, status };
      }
    },

    async revokeAllApiTokens(identifier: string): Promise<void> {
      try {
        const tokens = await tokenTable.where('identifier', '==', identifier).get();
        for (const t of tokens) {
          await tokenTable.update(t.id, { isActive: false });
        }
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to revoke all tokens');
        throw { errorResponse, status };
      }
    },

    // -------------------------------------------------------------------------
    // II. VALIDATION
    // -------------------------------------------------------------------------
    async validateApiToken(token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }> {
      try {
        const allTokens = await tokenTable.getAll();

        for (const apiToken of allTokens) {
          const isValid = await tokenGenerator.verifyToken(token, apiToken.tokenHash);
          if (isValid) {
            if (!apiToken.isActive) return { isValid: false, error: 'Token revoked' };
            if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date())
              return { isValid: false, error: 'Token expired' };

            await tokenTable.update(apiToken.id, { lastUsed: new Date().toISOString() });
            return { isValid: true, token: apiToken };
          }
        }

        return { isValid: false, error: 'Invalid token' };
      } catch (e) {
        const { errorResponse } = handleError(e, 'Token validation failed');
        return { isValid: false, error: errorResponse.error };
      }
    },

    // -------------------------------------------------------------------------
    // III. USAGE RECORDS
    // -------------------------------------------------------------------------
    async recordTokenUsage(usage: ApiTokenUsage): Promise<void> {
      try {
        const newUsage = {
          ...usage,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        };
        await usageTable.create(newUsage);

        // Optional cleanup
        const all = await usageTable
          .where('tokenId', '==', usage.tokenId)
          .orderBy('timestamp', 'desc')
          .get();

        if (all.length > API_TOKEN_CONSTANTS.MAX_USAGE_RECORDS) {
          const extra = all.slice(API_TOKEN_CONSTANTS.MAX_USAGE_RECORDS);
          for (const old of extra) await usageTable.delete(old.id);
        }
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to record token usage');
        throw { errorResponse, status };
      }
    },

    async getTokenUsage(tokenId: string, days: number = 30): Promise<ApiTokenUsage[]> {
      try {
        const usages = await usageTable.where('tokenId', '==', tokenId).get();
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return usages.filter(u => new Date(u.timestamp) >= cutoff);
      } catch (e) {
        const { errorResponse, status } = handleError(e, 'Failed to get token usage');
        throw { errorResponse, status };
      }
    },
  };
}

// -----------------------------------------------------------------------------
// Helpers: Token generator & permissions
// -----------------------------------------------------------------------------
export function createTokenGenerator(env: any): ITokenGenerator {
  return {
    generateToken(): string {
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const token = btoa(String.fromCharCode(...randomBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      return `${API_TOKEN_CONSTANTS.TOKEN_PREFIX}${token}`;
    },

    async hashToken(token: string): Promise<string> {
      const encoder = new TextEncoder();
      const data = encoder.encode(token + env.JWT_SECRET);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async verifyToken(token: string, hash: string): Promise<boolean> {
      const computed = await this.hashToken(token);
      return computed === hash;
    },
  };
}

export function createPermissionService(): IPermissionService {
  const available = [
    'read:profile',
    'write:profile',
    'read:tokens',
    'write:tokens',
    'ekyc:document:recognize',
    'ekyc:face:verify',
    'ekyc:face:liveness',
    'admin:all',
  ];

  return {
    validatePermissions(required: string[], userPerms: string[]): boolean {
      if (userPerms.includes('admin:all')) return true;
      return required.every(p => userPerms.includes(p));
    },
    getAvailablePermissions(): string[] {
      return [...available];
    },
    createDefaultPermissions(): string[] {
      return ['read:profile'];
    },
  };
}
