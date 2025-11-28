import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  IApiTokenService,
  ITokenGenerator,
  IPermissionService,
  ApiToken,
  CreateApiToken,
  ApiTokenSchema,
} from './domain';
import { TOKEN_CONSTANTS, DEFAULT_PERMISSIONS, ERROR_MESSAGES } from './constant';
import { tokenGenerationUtils } from './utils';

export function createApiTokenService(env:Env, userDO: DurableObjectStub<UserDO>): IApiTokenService {
  
  const executeRepositoryAction = async (operation: string, data: any, table: string = 'api_tokens'): Promise<any> => {
    const response = await userDO.fetch('http://user.internal/repository/action', {
      method: 'POST',
      body: JSON.stringify({ table, operation, data })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to ${operation} ${table}: ${errorText}`);
    }
    
    return await response.json();
  };

  const executeRepositorySelect = async (sql: string, params: any[] = []): Promise<any[]> => {
    const response = await userDO.fetch('http://user.internal/repository/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }
    
    return await response.json();
  };

  // -----------------------------------------------------------------------------
  // Token Generator Implementation
  // -----------------------------------------------------------------------------
  const createTokenGenerator = (): ITokenGenerator => {
    
    return {
      generateToken(): string {
        return tokenGenerationUtils.generateSecureToken();
      },

      async hashToken(token: string): Promise<string> {
        return await tokenGenerationUtils.hashToken(token, env.JWT_SECRET);
      },

      async verifyToken(token: string, hash: string): Promise<boolean> {
        return await tokenGenerationUtils.verifyToken(token, hash, env.JWT_SECRET);
      },
    };
  };

  // -----------------------------------------------------------------------------
  // Permission Service Implementation
  // -----------------------------------------------------------------------------
  const createPermissionService = (): IPermissionService => {
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
  };

  // Helper methods
  const validateTokenActive = (token: any): void => {
    if (!token.isActive) {
      throw new Error('Token is inactive');
    }
    
    if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
      throw new Error(ERROR_MESSAGES.TOKEN.TOKEN_EXPIRED);
    }
  };

  const mergePermissions = (defaultPerms: string[], customPerms?: string[]): string[] => {
    if (!customPerms || customPerms.length === 0) {
      return defaultPerms;
    }
    
    return [...new Set([...defaultPerms, ...customPerms])];
  };

  const calculateExpiryDate = (expiresInDays?: number): string | undefined => {
    if (!expiresInDays) return undefined;
    
    return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  };

  const sanitizeTokenForResponse = (tokens: any[]): any[] => {
    return tokens.map(({ tokenHash, ...token }) => token);
  };

  // Token Management Methods
  const createToken = async (identifier: string, request: CreateApiToken): Promise<{apiToken: any, rawToken: string}> => {
    const tokenGenerator = createTokenGenerator();
    const permissionService = createPermissionService();

    const rawToken = tokenGenerator.generateToken();
    const tokenHash = await tokenGenerator.hashToken(rawToken);
    const expiresAt = calculateExpiryDate(request.expiresInDays);
    const mergedPerms = mergePermissions(permissionService.createDefaultPermissions(), request.permissions);

    const apiToken: ApiToken = {
      identifier,
      name: request.name,
      tokenHash,
      permissions: mergedPerms,
      expiresAt,
      isActive: true,
    };

    const createdToken = await executeRepositoryAction('create', apiToken);
    
    return { 
      apiToken: createdToken, 
      rawToken 
    };
  };

  const getUserTokens = async (): Promise<any[]> => {
    const tokens = await executeRepositorySelect(
      'SELECT * FROM api_tokens WHERE is_active = ? ORDER BY created_at DESC',
      [true]
    );
    
    return sanitizeTokenForResponse(tokens);
  };

  const revokeToken = async (tokenId: string): Promise<void> => {
    const token = await executeRepositoryAction('findById', { id: tokenId });
    
    if (!token) {
      throw new Error(ERROR_MESSAGES.TOKEN.TOKEN_NOT_FOUND);
    }
    
    await executeRepositoryAction('update', { 
      id: tokenId, 
      data: { isActive: false } 
    });
  };

  const revokeAllTokens = async (): Promise<void> => {
    const tokens = await executeRepositorySelect(
      'SELECT id FROM api_tokens WHERE is_active = ?',
      [true]
    );
    
    for (const token of tokens) {
      await executeRepositoryAction('update', { 
        id: token.id, 
        data: { isActive: false } 
      });
    }
  };

  const validateToken = async (token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }> => {
    const tokenGenerator = createTokenGenerator();
    
    const allTokens = await executeRepositorySelect(
      'SELECT * FROM api_tokens WHERE is_active = ?',
      [true]
    );

    for (const apiToken of allTokens) {
      const isValid = await tokenGenerator.verifyToken(token, apiToken.tokenHash);
      
      if (isValid) {
        try {
          validateTokenActive(apiToken);
          return { isValid: true, token: apiToken };
        } catch (error) {
          return { 
            isValid: false, 
            error: error instanceof Error ? error.message : ERROR_MESSAGES.TOKEN.INVALID_TOKEN 
          };
        }
      }
    }
    
    return { 
      isValid: false, 
      error: ERROR_MESSAGES.TOKEN.INVALID_TOKEN 
    };
  };

  return {
    // -------------------------------------------------------------------------
    // I. TOKEN MANAGEMENT
    // -------------------------------------------------------------------------
    createApiToken: (identifier: string, request: CreateApiToken) => 
      createToken(identifier, request),

    getUserApiTokens: () => 
      getUserTokens(),

    revokeApiToken: (tokenId: string) => 
      revokeToken(tokenId),

    revokeAllApiTokens: () => 
      revokeAllTokens(),

    // -------------------------------------------------------------------------
    // II. VALIDATION
    // -------------------------------------------------------------------------
    validateApiToken: (token: string) => 
      validateToken(token),
  };
}