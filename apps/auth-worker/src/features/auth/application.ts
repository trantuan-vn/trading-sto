import { Context } from 'hono';
import { getDO } from '../../shared/utils';
import { UserDO } from '../../shared/infrastructure/UserDO';
import { SiweMessage } from 'siwe';

import { User, OAuthProvider, OAuthTokenResponse } from './domain';
import { getOAuthConfig, getOAuthScopes, generateWallet, isValidEmail, isValidPhone, generateAccessToken, generateRefreshToken, verifyJWT, normalizeIdentifier } from './utils';
import { createOAuthService, createKvRateLimitService, createUserRepository, createOTPService, createWalletService } from './infrastructure';

interface IApplicationService {
  // I. OAUTH
  getAuthUrlUseCase(provider: OAuthProvider): Promise<{sessionId: string, authUrl: string}>;
  exchangeOAuthCodeUseCase(provider: string, sessionId: string, state: string, code: string ): Promise<{tokenData: OAuthTokenResponse, validatedUserInfo: any}>;
  connectOAuthUseCase(provider: string, identifier: string, tokenData: any, validatedUserInfo: any): Promise<{ token: string; refreshToken: string }>;
  // II. EMAIL/PHONE
  getRequestOtpUseCase(identifier: string): Promise<string>;
  verifyOtpUseCase(identifier: string, sessionId: string, otp: string): Promise<{ token: string; refreshToken: string }>;
  // III. WALLET
  generateNonceUseCase(): Promise<{ nonce: string; sessionId: string }>;
  verifySignatureUseCase(sessionId: string, message: string, signature: string): Promise<SiweMessage>;
  connectWalletUseCase(address: string): Promise<{ token: string; refreshToken: string }>;
  // IV. Common
  logoutUseCase(identifier: string, refreshToken: string): Promise<void>;
  logoutAllUseCase(identifier: string): Promise<void>;
  verifyTokenUseCase(token: string, refreshToken: string): Promise<{ok: boolean; user: any}>;
  refreshTokenUseCase(refreshToken: string): Promise<{ok: boolean; user: any; token: string}>;
}

export function createApplicationService(c: Context, bindingName: string): IApplicationService {
  return {
    // I. OAUTH
    async getAuthUrlUseCase(provider: OAuthProvider): Promise<{sessionId: string, authUrl: string}> {
      const kvRateLimitService = createKvRateLimitService(c.env);
      const oauthService = createOAuthService(c.env);
      await kvRateLimitService.checkRateLimit();
      const {state, sessionId} = await oauthService.generateState()

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
    async exchangeOAuthCodeUseCase(provider: string, sessionId: string, state: string, code: string ): Promise<{tokenData: OAuthTokenResponse, validatedUserInfo: any}>{
      const kvRateLimitService = createKvRateLimitService(c.env);
      const oauthService = createOAuthService(c.env);
      await kvRateLimitService.checkRateLimit();
      const tokenData= await oauthService.exchangeOAuthCode(provider, sessionId, state, code);
      const validatedUserInfo = await oauthService.getUserInfoFromProvider(provider, tokenData.access_token);
      return {tokenData, validatedUserInfo};
    },
    async connectOAuthUseCase(provider: string, identifier: string, tokenData: any, userInfo: any): Promise<{ token: string; refreshToken: string }> {
      let user: User | undefined;
      
      const userDO = getDO<UserDO>(c, identifier, bindingName); 
      const userRepository = createUserRepository(userDO.getStorage());

      try {
        // Try to get existing user
        user = await userRepository.get();
        if (!user) throw new Error('User not found');
        
        // Update OAuth data for existing user
        user.oauthData = user.oauthData || {};
        user.oauthData[provider] = {
          id: userInfo.sub || userInfo.id || userInfo.data?.id,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
          profile: userInfo
        };
        
      } catch (error) {
        // User doesn't exist, create new one
        const wallet = await generateWallet(c.env.ENCRYPTION_SECRET);
        user = {
          id: userDO.getCurrentUserId(),
          identifier,
          address: wallet.address,
          privateKey: wallet.privateKey,
          mnemonicPhrase: wallet.mnemonicPhrase,
          createdAt: new Date().toISOString(),
          refreshTokens: [],
          oauthData: {
            [provider]: {
              id: userInfo.sub || userInfo.id || userInfo.data?.id,
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
              profile: userInfo
            }
          }
        };
      }
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);

      // Store refresh token
      if (!user.refreshTokens) user.refreshTokens = [];
      user.refreshTokens.push(refreshToken);

      // Save user data
      await userRepository.save(user);

      return { token, refreshToken };      
    },
    // II. EMAIL/PHONE
    async getRequestOtpUseCase(identifier: string): Promise<string> {
      const kvRateLimitService = createKvRateLimitService(c.env);
      const otpService = createOTPService(c.env);
      await kvRateLimitService.checkRateLimit();
      const {otp, sessionId} = await otpService.generateOTP();
      const nIdentifier= normalizeIdentifier(identifier);
      if (isValidEmail(nIdentifier)) {
        await otpService.sendEmailOTP(nIdentifier, otp);
      }
      if (isValidPhone(nIdentifier)) {
        await otpService.sendSmsOTP(nIdentifier, otp, "VONAGE");
      }
      return sessionId
    },
    async verifyOtpUseCase(identifier: string, sessionId: string, otp: string): Promise<{ token: string; refreshToken: string }> {
      const kvRateLimitService = createKvRateLimitService(c.env);
      const otpService = createOTPService(c.env);
      await kvRateLimitService.checkRateLimit();
      const isValid = await otpService.verifyOTP(otp, sessionId);
      if (!isValid) {
        throw new Error('Invalid OTP');
      }
      const nIdentifier= normalizeIdentifier(identifier);
      const userDO = getDO<UserDO>(c, nIdentifier, bindingName);
      const userRepository = createUserRepository(userDO.getStorage());   
      let user: User | undefined;
      try {
        user = await userRepository.get();
        if (!user) throw new Error('User not found');
      } catch (error) {
        // User doesn't exist, create new one
        const wallet = await generateWallet(c.env.ENCRYPTION_SECRET);
        user = {
          id: userDO.getCurrentUserId(),
          identifier: nIdentifier,
          address: wallet.address,
          privateKey: wallet.privateKey,
          mnemonicPhrase: wallet.mnemonicPhrase,
          createdAt: new Date().toISOString(),
          refreshTokens: [],
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
      
      // Generate tokens
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);
      // Store refresh token
      if (!user.refreshTokens) user.refreshTokens = [];
      user.refreshTokens.push(refreshToken);
      // Save user data
      await userRepository.save(user);
      return { token, refreshToken };          
    },
    // III. WALLET
    async generateNonceUseCase(): Promise<{ nonce: string; sessionId: string }> {
      const kvRateLimitService = createKvRateLimitService(c.env);
      const walletService = createWalletService(c.env);
      await kvRateLimitService.checkRateLimit();
      return await walletService.generateNonceAndStore();
    },
    async verifySignatureUseCase(sessionId: string, message: string, signature: string): Promise<SiweMessage> {
      const kvRateLimitService = createKvRateLimitService(c.env);
      const walletService = createWalletService(c.env);      
      await kvRateLimitService.checkRateLimit();
      return await walletService.verifySignature(sessionId, message, signature);
    },
    async connectWalletUseCase(address: string): Promise<{ token: string; refreshToken: string }> {
      const kvRateLimitService = createKvRateLimitService(c.env);
      await kvRateLimitService.checkRateLimit();
      const userDO = getDO<UserDO>(c, address, bindingName); 
      const userRepository = createUserRepository(userDO.getStorage());
      // Try to get existing user
      let user: User | undefined;
      try {
        user = await userRepository.get();
        if (!user) throw new Error('User not found');
      } catch (error) {
        user = {
            id: userDO.getCurrentUserId(),
            identifier: address,
            address: address,
            createdAt: new Date().toISOString(),
            refreshTokens: [] as string[]
        };
      }
      // Generate tokens
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user.id, user.identifier, c.env.JWT_SECRET);
      // Store refresh token
      if (!user.refreshTokens) user.refreshTokens = [];
      user.refreshTokens.push(refreshToken);
      // Save user data
      await userRepository.save(user);
      return { token, refreshToken };          
    },
    // IV. Common
    async logoutUseCase(identifier: string, refreshToken: string): Promise<void> {
      const kvRateLimitService = createKvRateLimitService(c.env);      
      await kvRateLimitService.checkRateLimit();
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const userRepository = createUserRepository(userDO.getStorage());
      const user = await userRepository.get();
      if (!user) throw new Error('User not found');
      user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
      await userRepository.save(user);
    },
    async logoutAllUseCase(identifier: string): Promise<void>{
      const kvRateLimitService = createKvRateLimitService(c.env);      
      await kvRateLimitService.checkRateLimit();
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const userRepository = createUserRepository(userDO.getStorage());
      const user = await userRepository.get();
      if (!user) throw new Error('User not found');
      user.refreshTokens = [];
      await userRepository.save(user);

    },
    async verifyTokenUseCase(token: string, refreshToken: string): Promise<{ok: boolean; user: any}>{
      const result = await verifyJWT(token, c.env.JWT_SECRET);
      if (!result.ok) {
        throw new Error('Invalid token');
      }
      const identifier = result.payload?.identifier;
      if (!identifier) {
        throw new Error('Invalid identifier');
      }
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const userRepository = createUserRepository(userDO.getStorage());
      const user = await userRepository.get();
      if (!user) {
        throw new Error('User not found');
      }
      if (!user.refreshTokens.includes(refreshToken)) {
        throw new Error('Invalid refresh token');
      }
      return { ok: true, user: user };
    },
    async refreshTokenUseCase(refreshToken: string): Promise<{ok: boolean; user: any, token: string}>{
      const result = await verifyJWT(refreshToken, c.env.JWT_SECRET);
      if (!result.ok) {
        throw new Error('Invalid token');
      }
      const identifier = result.payload?.identifier;
      if (!identifier) {
        throw new Error('Invalid identifier');
      }
      const userDO = getDO<UserDO>(c, identifier, bindingName);
      const userRepository = createUserRepository(userDO.getStorage());
      const user = await userRepository.get();
      if (!user) {
        throw new Error('User not found');
      }
      if (!user.refreshTokens.includes(refreshToken)) {
        throw new Error('Invalid refresh token');
      } 
      // Generate tokens
      const token = await generateAccessToken(user.id, user.identifier, c.env.JWT_SECRET);
      return { ok: true, user: user, token: token };
    }
  }
}