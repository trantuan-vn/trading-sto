import { 
  IApiTokenService,
  ITokenGenerator,
  IPermissionService,
  ApiToken,
  CreateApiToken,
  ApiTokenSchema,
  IKvService
} from './domain';
import { API_TOKEN_CONSTANTS, AUTH_CONSTANTS, DEFAULT_PERMISSIONS } from './constants';
import { UserDO } from '../ws/infrastructure/UserDO';

// -----------------------------------------------------------------------------
// Main Factory
// -----------------------------------------------------------------------------
export function createApiTokenService(userDO: UserDO): IApiTokenService {
  const tokenGenerator = createTokenGenerator(userDO.getEnv());
  const permissionService = createPermissionService();

  // Use table-based abstraction from UserDO
  const tokenTable = userDO.table('api_tokens', ApiTokenSchema, { userScoped: true });

  return {
    // -------------------------------------------------------------------------
    // I. TOKEN MANAGEMENT
    // -------------------------------------------------------------------------
    async createApiToken(identifier: string, request: CreateApiToken): Promise<{apiToken: any, rawToken: string}> {
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
        identifier,
        name: request.name,
        tokenHash,
        permissions: mergedPerms,
        expiresAt,
        isActive: true,
      };

      return { apiToken: await tokenTable.create(apiToken), rawToken: rawToken };
    },

    async getUserApiTokens(): Promise<any[]> {
      const tokens = await tokenTable.getAll();
      return tokens.map(({ tokenHash, ...token }) => token);
    },

    async revokeApiToken(tokenId: string): Promise<void> {
      const token = await tokenTable.findById(tokenId);
      if (!token) {
        throw new Error('Token not found');
      }
      await tokenTable.update(tokenId, { isActive: false });
    },

    async revokeAllApiTokens(): Promise<void> {
      const tokens = await tokenTable.getAll();
      for (const t of tokens) {
        await tokenTable.update(t.id, { isActive: false });
      }
    },

    // -------------------------------------------------------------------------
    // II. VALIDATION
    // -------------------------------------------------------------------------
    async validateApiToken(token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }> {
      const allTokens = await tokenTable.getAll();

      for (const apiToken of allTokens) {
        const isValid = await tokenGenerator.verifyToken(token, apiToken.tokenHash);
        if (isValid) {
          if (!apiToken.isActive) 
            throw new Error('Token is inactive');
          if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date())
            throw new Error('Token expired');

          return { isValid: true, token: apiToken };
        }
      }
      return { isValid: false, error: 'Invalid token' };
    }

    
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
      const computed = await this.hashToken(token+ env.JWT_SECRET);
      return computed === hash;
    },
  };
}

export function createPermissionService(): IPermissionService {
  return {
    validatePermissions(required: string[], userPerms: string[]): boolean {
      if (userPerms.includes('admin:all')) return true;
      return required.every(p => userPerms.includes(p));
    },
    getAvailablePermissions(): string[] {
      return [...DEFAULT_PERMISSIONS];
    },
    createDefaultPermissions(): string[] {
      return [...DEFAULT_PERMISSIONS];
    },
  };
}

// Factory function để tạo KV service
export function createKvService(env: any): IKvService {
  return {
    async checkRateLimit(sessionId: string): Promise<void> {
      const now = Date.now();
      
      const recordStr = await env.NONCE_KV.get(`RateLimit:${sessionId}`);
      const record = recordStr ? JSON.parse(recordStr) : null;

      if (record && record.resetAt > now) {
        if (record.count >= AUTH_CONSTANTS.RATE_LIMIT_MAX) {
          throw new Error('Too many requests');
        }

        record.count += 1;
        await env.NONCE_KV.put(
          `RateLimit:${sessionId}`,
          JSON.stringify(record),
          {
            expirationTtl: AUTH_CONSTANTS.RATE_LIMIT_WINDOW / 1000,
          }
        );
      } else {
        const resetAt = now + AUTH_CONSTANTS.RATE_LIMIT_WINDOW;
        const newRecord = { count: 1, resetAt };
        await env.NONCE_KV.put(
          `RateLimit:${sessionId}`,
          JSON.stringify(newRecord),
          {
            expirationTtl: AUTH_CONSTANTS.RATE_LIMIT_WINDOW / 1000,
          }
        );
      }
    }
  };
}