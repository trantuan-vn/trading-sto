import jwt from '@tsndr/cloudflare-worker-jwt';
import { mnemonicToAccount, generateMnemonic, english } from 'viem/accounts'; 
import CryptoJS from 'crypto-js';
import { Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'


import { 
  OAuthConfig, 
  OAuthProvider, 
  GoogleUserInfo, 
  AppleUserInfo, 
  FacebookUserInfo, 
  GitHubUserInfo, 
  TwitterUserInfo,
  JwtPayload 
} from './domain'
import { AUTH_CONSTANTS, ERROR_MESSAGES } from './constant';


// I. JWT Utilities
export const jwtUtils = {
  async signJWT(payload: JwtPayload, secret: string): Promise<string> {
    const token = await jwt.sign(payload, secret);
    return token;
  },

  async verifyJWT(token: string, secret: string): Promise<{
    ok: boolean;
    payload?: JwtPayload;
    error?: string;
  }> {
    try {
      // Validate token format first
      if (!token || typeof token !== 'string') {
        return { ok: false, error: "token is empty or not a string" };
      }      
      const jwtData = await jwt.verify(token, secret, { throwError: true });
      if (!jwtData) {
        return { ok: false, error: "token verification is failed" };
      }

      const decoded = jwt.decode(token);
      if (!decoded?.payload) {
        return { ok: false, error: "token payload is empty" };
      }
      // Validate JWT payload structure
      const payload = decoded.payload as JwtPayload;
      if (!payload.sub || !payload.exp || !payload.iat || !payload.type) {
        return { ok: false, error: `one of those fields is missing: sub(${payload.sub}), exp(${payload.exp}), iat(${payload.iat}), type(${payload.type})` };
      }
      
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return { ok: false, error: `token is expired: exp(${new Date(payload.exp * 1000).toISOString()})` };
      }

      return { ok: true, payload: decoded.payload as JwtPayload };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'token verification failed'
      };
    }
  },

  async generateAccessToken(
    userId: string, 
    identifier: string, 
    secret: string, 
    expiresInSeconds: number = AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY
  ): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + expiresInSeconds;
    return await this.signJWT({
      sub: userId,
      identifier: identifier.toLowerCase(),
      iat,
      exp,
      type: 'access'
    }, secret);
  },

  async generateRefreshToken(
    userId: string,
    identifier: string, 
    secret: string,
    expiresInSeconds: number = AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY
  ): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + expiresInSeconds;
    
    return await this.signJWT({
      sub: userId,
      identifier: identifier.toLowerCase(),
      iat,
      exp,
      type: 'refresh'
    }, secret);
  }
};

// II. Validation Utilities
export const validationUtils = {
  isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  isValidPhone(phone: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/\D/g, ''));
  },

  normalizeIdentifier(identifier: string): string {
    if (this.isValidEmail(identifier)) {
      return identifier.toLowerCase();
    } else if (this.isValidPhone(identifier)) {
      const digits = identifier.replace(/\D/g, '');
      return digits.startsWith('+') ? digits : `+${digits}`;
    }
    return identifier.toLowerCase();
  },

  validateSession(session: any, token?: string, refreshToken?: string): void {
    if (!session?.isActive) {
      throw new Error(`session is not active: ${JSON.stringify(!session?.isActive)}`);
    }
    
    if (new Date(session.expiresAt) < new Date()) {
      throw new Error(ERROR_MESSAGES.AUTH.SESSION_EXPIRED);
    }
    
    if (token && session.token !== token) {
      throw new Error(`token is not same as session in DB: ${token} !== ${session.token}`);
    }
    
    if (refreshToken && session.refreshToken !== refreshToken) {
      throw new Error(`refreshToken is not same as session in DB: ${refreshToken} !== ${session.refreshToken}`);
    }
  }
};

// III. Wallet Utilities
export const walletUtils = {
  async generateWallet(encryptionSecret: string): Promise<{
    address: string;
    privateKey: string;
    mnemonicPhrase: string;
  }> {
    const mnemonic = generateMnemonic(english, 256);
    const account = mnemonicToAccount(mnemonic);
    
    const encryptedPrivateKey = CryptoJS.AES.encrypt(
      account.getHdKey().privateExtendedKey,
      encryptionSecret
    ).toString();

    const encryptedMnemonic = CryptoJS.AES.encrypt(
      mnemonic,
      encryptionSecret
    ).toString();
    
    return {
      address: account.address,
      privateKey: encryptedPrivateKey,
      mnemonicPhrase: encryptedMnemonic
    };
  }
};

// IV. OTP Utilities
export const otpUtils = {
  generateOTP(length = 6): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }
};

// V. Cookie Utilities
export const cookieUtils = {
  setCookieWithOption(c: Context, name: string, value: string, maxAge: number) {
    const cookieOptions = {
      sameSite: 'strict' as const, 
      httpOnly: true,
      secure: true,
      path: '/',
      domain: '.unitoken.trade',
      maxAge,
    };
    setCookie(c, name, value, cookieOptions);
  },

  clearAuthCookies(c: Context) {
    const cookieOptions = {
      path: '/',
      domain: '.unitoken.trade',
      secure: true,
      sameSite: 'strict' as const,
      httpOnly: true,
    };
    
    deleteCookie(c, 'token', cookieOptions);
    deleteCookie(c, 'refreshToken', cookieOptions);
    deleteCookie(c, 'sessionId', cookieOptions);
  },

  setAuthCookies(c: Context, sessionId: string, token: string, refreshToken: string) {
    this.setCookieWithOption(c, 'token', token, AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY);
    this.setCookieWithOption(c, 'refreshToken', refreshToken, AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY);
    this.setCookieWithOption(c, 'sessionId', sessionId, AUTH_CONSTANTS.SESSION_EXPIRY);
  }
};

// VI. OAuth Utilities
export const oauthUtils = {
  getOAuthScopes(provider: OAuthProvider): string {
    const scopes: Record<OAuthProvider, string> = {
      google: "openid email profile",
      apple: "name email",
      facebook: "email",
      github: "user:email",
      twitter: "users.read tweet.read",
    };
    return scopes[provider];
  },

  getOAuthConfig(provider: string, env?: Env): OAuthConfig {
    const configs: { [key: string]: OAuthConfig } = {
      google: {
        clientId: env?.GOOGLE_CLIENT_ID || "",
        clientSecret: env?.GOOGLE_CLIENT_SECRET || "",
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        userInfoEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',
        redirectUri: `${env?.BASE_URL || ""}/api/oauth/google/callback`
      },
      apple: {
        clientId: env?.APPLE_CLIENT_ID || "",
        clientSecret: env?.APPLE_CLIENT_SECRET || "",
        tokenEndpoint: 'https://appleid.apple.com/auth/token',
        userInfoEndpoint: 'https://appleid.apple.com/auth/userinfo',
        redirectUri: `${env?.BASE_URL || ""}/api/oauth/apple/callback`
      },
      facebook: {
        clientId: env?.FACEBOOK_CLIENT_ID || "",
        clientSecret: env?.FACEBOOK_CLIENT_SECRET || "",
        tokenEndpoint: 'https://graph.facebook.com/v18.0/oauth/access_token',
        userInfoEndpoint: 'https://graph.facebook.com/me?fields=id,name,email',
        redirectUri: `${env?.BASE_URL || ""}/api/oauth/facebook/callback`
      },
      github: {
        clientId: env?.GITHUB_CLIENT_ID || "",
        clientSecret: env?.GITHUB_CLIENT_SECRET || "",
        tokenEndpoint: 'https://github.com/login/oauth/access_token',
        userInfoEndpoint: 'https://api.github.com/user',
        redirectUri: `${env?.BASE_URL || ""}/api/oauth/github/callback`
      },
      twitter: {
        clientId: env?.TWITTER_CLIENT_ID || "",
        clientSecret: env?.TWITTER_CLIENT_SECRET || "",
        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
        userInfoEndpoint: 'https://api.x.com/2/users/me',
        redirectUri: `${env?.BASE_URL || ""}/api/oauth/twitter/callback`
      }
    };

    const config = configs[provider];
    if (!config?.clientId || !config?.clientSecret) {
      throw new Error(`OAuth configuration missing for ${provider}`);
    }

    return config;
  },

  normalizeOAuthIdentifier(provider: string, userInfo: any): string {
    switch (provider) {
      case 'google':
        const googleInfo = userInfo as GoogleUserInfo;
        return googleInfo.email.toLowerCase();
      
      case 'apple':
        const appleInfo = userInfo as AppleUserInfo;
        return appleInfo.email.toLowerCase();
      
      case 'facebook':
        const fbInfo = userInfo as FacebookUserInfo;
        return fbInfo.email?.toLowerCase() || `fb_${fbInfo.id}@oauth.user`;
      
      case 'github':
        const ghInfo = userInfo as GitHubUserInfo;
        return ghInfo.email?.toLowerCase() || `gh_${ghInfo.login}@oauth.user`;
      
      case 'twitter':
        const twInfo = userInfo as TwitterUserInfo;
        return `tw_${twInfo.data.username}@oauth.user`;
      
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
};

