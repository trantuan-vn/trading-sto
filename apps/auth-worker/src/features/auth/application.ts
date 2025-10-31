import { Context } from 'hono';
import { getDO, isAdmin } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { SiweMessage } from 'siwe';

import { User, OAuthProvider, Session } from './domain';
import { getOAuthConfig, getOAuthScopes, generateWallet, isValidEmail, isValidPhone, 
  generateAccessToken, generateRefreshToken, verifyJWT, normalizeIdentifier, validateSession } from './utils';
import { createOAuthService, createKvService, createRepository, createOTPService, createWalletService } from './infrastructure';
import { AUTH_CONSTANTS } from './constants';


interface IApplicationService {
  // I. OAUTH
  getAuthUrlUseCase(provider: OAuthProvider, sessionId: string): Promise<{sessionId: string, authUrl: string}>;
  exchangeOAuthCodeUseCase(provider: string, sessionId: string, state: string, code: string ): Promise<any>;
  connectOAuthUseCase(sessionId: string, identifier: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }>;
  // II. EMAIL/PHONE
  getRequestOtpUseCase(identifier: string, sessionId: string): Promise<void>;
  verifyOtpUseCase(identifier: string, sessionId: string, otp: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }>;
  // III. WALLET
  generateNonceUseCase(sessionId: string): Promise<string>;
  verifySignatureUseCase(sessionId: string, message: string, signature: string): Promise<SiweMessage>;
  connectWalletUseCase(sessionId: string, address: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }>;
  // IV. Common
  logoutUseCase(identifier: string, sessionId: string): Promise<void>;
  logoutAllUseCase(identifier: string, sessionId: string): Promise<void>;
  verifyTokenUseCase(sessionId: string, token: string, refreshToken: string): Promise<{ok: boolean; user: any}>;
  refreshTokenUseCase(sessionId: string, refreshToken: string): Promise<{ok: boolean; user: any; token: string, refreshToken: string}>;
}

export function createApplicationService(c: Context, bindingName: string): IApplicationService {
  return {
    // I. OAUTH
    async getAuthUrlUseCase(provider: OAuthProvider, sessionId: string): Promise<{sessionId: string, authUrl: string}> {
      const kvService = createKvService(c.env);
      await kvService.checkRateLimit(sessionId);

      const oauthService = createOAuthService(c.env);      
      const state = await oauthService.generateState(sessionId);

      const config = getOAuthConfig(provider, c.env);
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: getOAuthScopes(provider),
        state: state, 
      });
    
      switch (provider) {
        case 'google':
          return { sessionId, authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
        case 'apple':
          return { sessionId, authUrl: `https://appleid.apple.com/auth/authorize?${params}` };
        case 'facebook':
          return { sessionId, authUrl: `https://www.facebook.com/v18.0/dialog/oauth?${params}` };
        case 'github':
          return { sessionId, authUrl: `https://github.com/login/oauth/authorize?${params}` };
        case 'twitter':
          return { sessionId, authUrl: `https://x.com/i/oauth2/authorize?${params}` };
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }
    },
    async exchangeOAuthCodeUseCase(provider: string, sessionId: string, state: string, code: string ): Promise<any>{
      const kvService = createKvService(c.env);
      await kvService.checkRateLimit(sessionId);
      const oauthService = createOAuthService(c.env);      
      const tokenData= await oauthService.exchangeOAuthCode(provider, sessionId, state, code);
      return await oauthService.getUserInfoFromProvider(provider, tokenData.access_token);      
    },
    async connectOAuthUseCase(sessionId: string, identifier: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }> {
      let user: User | null;
      
      const userDO = getDO<UserDO>(c, identifier, bindingName); 
      const repository = createRepository(userDO);

      try {
        // Try to get existing user
        user = await repository.users.get();
        if (!user) throw new Error('User not found');

      } catch (error) {
        // User doesn't exist, create new one
        const wallet = await generateWallet(c.env.ENCRYPTION_SECRET);
        user = {
          id: userDO.getCurrentUserId(),
          identifier,
          role: isAdmin(identifier) ? 'admin' : 'member',
          address: wallet.address,
          privateKey: wallet.privateKey,
          mnemonicPhrase: wallet.mnemonicPhrase,
          createdAt: new Date().toISOString(),
        };
        // Update email
        if (isValidEmail(identifier)) {
          user.email = identifier;
        } 
        // Save user data
        await repository.users.save(user);
      }
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);

      const sessionData: Session = {
        id: sessionId,
        type: 'oauth',
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString(), 
        createdAt: new Date().toISOString(),
        token,
        refreshToken,
        ipAddress,
        userAgent,
        isActive: true,
      };
      await repository.sessions.create(sessionData);      
  
      return { token, refreshToken };      
    },
    // II. EMAIL/PHONE
    async getRequestOtpUseCase(identifier: string, sessionId: string): Promise<void> {
      const kvService = createKvService(c.env);
      await kvService.checkRateLimit(sessionId);

      const otpService = createOTPService(c.env);
      
      const otp= await otpService.generateOTP(sessionId);

      const nIdentifier= normalizeIdentifier(identifier);
      if (isValidEmail(nIdentifier)) {
        await otpService.sendEmailOTP(nIdentifier, otp);
      }
      if (isValidPhone(nIdentifier)) {
        await otpService.sendSmsOTP(nIdentifier, otp, "VONAGE");
      }
    },
    async verifyOtpUseCase(identifier: string, sessionId: string, otp: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }> {
      const kvService = createKvService(c.env);
      await kvService.checkRateLimit(sessionId);
      const otpService = createOTPService(c.env);
      
      const isValid = await otpService.verifyOTP(otp, sessionId);
      if (!isValid) {
        throw new Error('Invalid OTP');
      }
      const nIdentifier= normalizeIdentifier(identifier);
      const userDO = getDO<UserDO>(c, nIdentifier, bindingName);
      const repository = createRepository(userDO);   
      let user: User | null;
      try {
        user = await repository.users.get();
        if (!user) throw new Error('User not found');
      } catch (error) {
        // User doesn't exist, create new one
        const wallet = await generateWallet(c.env.ENCRYPTION_SECRET);
        user = {
          id: userDO.getCurrentUserId(),
          identifier: nIdentifier,
          role: isAdmin(nIdentifier) ? 'admin' : 'member',
          address: wallet.address,
          privateKey: wallet.privateKey,
          mnemonicPhrase: wallet.mnemonicPhrase,
          createdAt: new Date().toISOString(),
          }
      }
      // Update email
      if (isValidEmail(nIdentifier)) {
        user.email = nIdentifier;
      } 
      // Update phone
      if (isValidPhone(nIdentifier)) {
        user.phone = nIdentifier;    
      }
      // Save user data
      await repository.users.save(user);
      
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);      

      const sessionData: Session = {
        id: sessionId,
        type: 'otp',
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString(), 
        createdAt: new Date().toISOString(),
        token,
        refreshToken,
        ipAddress,
        userAgent,
        isActive: true,
      };
      await repository.sessions.create(sessionData);      

      return { token, refreshToken };          
    },
    // III. WALLET
    async generateNonceUseCase(sessionId: string): Promise<string> {
      const kvService = createKvService(c.env);
      await kvService.checkRateLimit(sessionId);
      const walletService = createWalletService(c.env);      
      return await walletService.generateNonceAndStore(sessionId);
    },
    async verifySignatureUseCase(sessionId: string, message: string, signature: string): Promise<SiweMessage> {
      const kvService = createKvService(c.env);
      await kvService.checkRateLimit(sessionId);
      const walletService = createWalletService(c.env);      
      return await walletService.verifySignature(sessionId, message, signature);
    },
    async connectWalletUseCase(sessionId: string, address: string, ipAddress: string, userAgent: string): Promise<{ token: string; refreshToken: string }> {
      const userDO = getDO<UserDO>(c, address, bindingName); 
      const repository = createRepository(userDO);
      // Try to get existing user
      let user: User | null;
      try {
        user = await repository.users.get();
        if (!user) throw new Error('User not found');
      } catch (error) {
        user = {
            id: userDO.getCurrentUserId(),
            identifier: address,
            role: isAdmin(address) ? 'admin' : 'member',
            address: address,
            createdAt: new Date().toISOString(),            
        };
      }
      // Save user data
      await repository.users.save(user);
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);

      const sessionData: Session = {
        id: sessionId,
        type: 'siwe',
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString(), 
        createdAt: new Date().toISOString(),
        token,
        refreshToken,
        ipAddress,
        userAgent,
        isActive: true,
      };
      await repository.sessions.create(sessionData);      

      return { token, refreshToken };          
    },
    // IV. Common
    async logoutUseCase(identifier: string, sessionId: string): Promise<void> {
      const kvService = createKvService(c.env);      
      await kvService.checkRateLimit(sessionId);
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const repository = createRepository(userDO);
      await repository.sessions.update(sessionId, { isActive: false });
    },
    async logoutAllUseCase(identifier: string, sessionId: string): Promise<void>{
      const kvService = createKvService(c.env);      
      await kvService.checkRateLimit(sessionId);
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const repository = createRepository(userDO);
      await repository.sessions.deactivateAllUserSessions(userDO.getCurrentUserId());
    },
    async verifyTokenUseCase(
      sessionId: string, 
      token: string, 
      refreshToken: string
    ): Promise<{ ok: boolean; user: any }> {
      // Verify JWT token
      const result = await verifyJWT(token, c.env.JWT_SECRET);
      if (!result.ok) {
        throw new Error(result.error ?? 'Invalid token');
      }
      
      const identifier = result.payload?.identifier;
      if (!identifier) {
        throw new Error('Invalid identifier');
      }

      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const repository = createRepository(userDO);
      
      // Get user and validate
      const user = await repository.users.get();
      if (!user) {
        throw new Error('User not found');
      }

      // Validate session
      const session = await repository.sessions.findById(sessionId);
      validateSession(session, token, refreshToken);

      return { ok: true, user };
    },

    async refreshTokenUseCase(
      sessionId: string, 
      refreshToken: string
    ): Promise<{ ok: boolean; user: any; token: string; refreshToken: string }> {
      // Verify refresh token
      const result = await verifyJWT(refreshToken, c.env.JWT_SECRET);
      if (!result.ok) {
        const errorMessage = result.error
          ?.replace('token', 'refreshToken')
          ?.replace('Token', 'RefreshToken') ?? 'Invalid refreshToken';
        throw new Error(errorMessage);
      }

      const identifier = result.payload?.identifier;
      if (!identifier) {
        throw new Error('Invalid identifier');
      }

      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const repository = createRepository(userDO);
      
      // Get user and validate
      const user = await repository.users.get();
      if (!user) {
        throw new Error('User not found');
      }

      // Validate session with refresh token only
      const session = await repository.sessions.findById(sessionId);
      validateSession(session, undefined, refreshToken);

      // Generate new tokens
      const newToken = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const newRefreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);
      
      // Update session with new tokens
      await repository.sessions.update(sessionId, { 
        token: newToken, 
        refreshToken: newRefreshToken, 
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString() 
      });

      return { 
        ok: true, 
        user, 
        token: newToken, 
        refreshToken: newRefreshToken 
      };
    }
  }
}