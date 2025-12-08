import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  IApiTokenService,
  ITokenGenerator,
  IPermissionService,
  ApiToken,
  CreateApiToken,
} from './domain';
import { DEFAULT_PERMISSIONS, ERROR_MESSAGES } from './constant';
import { tokenGenerationUtils } from './utils';

import { executeUtils } from '../../../shared/utils';
export function createApiTokenService(env:Env, userDO: DurableObjectStub<UserDO>): IApiTokenService {
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

    const createdToken = await executeUtils.executeDynamicAction(userDO, 'insert', apiToken);
    
    return { 
      apiToken: createdToken, 
      rawToken 
    };
  };

  const getUserTokens = async (): Promise<any[]> => {
    const tokens = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM api_tokens WHERE isActive = ? ORDER BY created_at DESC',
      [1]
    );
    
    return sanitizeTokenForResponse(tokens);
  };

  const revokeToken = async (tokenId: string): Promise<void> => {    
    await executeUtils.executeDynamicAction(userDO, 'update', { 
      id: tokenId, 
      data: { isActive: false } 
    });
  };

  const revokeAllTokens = async (): Promise<void> => {
    await executeUtils.executeTransaction(userDO, [
      {
        sql: 'UPDATE api_tokens SET isActive = 0',
        params: []
      }
    ]);
  };

  const validateToken = async (token: string): Promise<{ isValid: boolean; token?: ApiToken; error?: string }> => {    
    const allTokens = await executeUtils.executeRepositorySelect(userDO,
      'SELECT * FROM api_tokens WHERE isActive = ? and expiresAt >= ? and tokenHash = ?',
      [1, new Date().toISOString(), tokenGenerationUtils.hashToken(token, env.JWT_SECRET)]
    );
    if (allTokens.length === 0) {
      return { 
        isValid: false, 
        error: ERROR_MESSAGES.TOKEN.INVALID_TOKEN 
      };
    }
    return { isValid: true, token: allTokens[0] };
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