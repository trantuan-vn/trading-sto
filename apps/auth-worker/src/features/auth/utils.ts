import jwt from '@tsndr/cloudflare-worker-jwt';
import { mnemonicToAccount, generateMnemonic, english } from 'viem/accounts'; 
import CryptoJS from 'crypto-js';
import { Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'

import { OAuthConfig, OAuthProvider, GoogleUserInfo, AppleUserInfo, FacebookUserInfo, GitHubUserInfo, TwitterUserInfo } from './domain'

import { AUTH_CONSTANTS } from './constants';

// I. JWT
// JWT payload type matching the UserDO internal implementation
export type JwtPayload = {
  sub: string;
  identifier?: string; // Optional for refresh tokens
  exp?: number;
  iat?: number;
  type?: string; // For refresh tokens, access tokens, etc.
};

/**
 * Check if token is expired
 * @param payload - JWT payload
 * @returns true if token is expired
 */
function isTokenExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  return payload.exp < Math.floor(Date.now() / 1000);
}

/**
 * Sign a JWT token with the given payload and secret
 * @param payload - JWT payload
 * @param secret - JWT secret
 * @returns Promise resolving to signed token
 */
async function signJWT(payload: JwtPayload, secret: string): Promise<string> {
  return await jwt.sign(payload, secret);
}

/**
 * JWT verification with secret - extracted from UserDO implementation
 * @param token - JWT token to verify
 * @param secret - JWT secret for verification
 * @returns Verification result with payload if valid
 */
export async function verifyJWT(token: string, secret: string): Promise<{
  ok: boolean;
  payload?: JwtPayload;
  error?: string;
}> {
  try {
    const isValid = await jwt.verify(token, secret);
    if (!isValid) {
      return { ok: false, error: 'Invalid token' };
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.payload) {
      return { ok: false, error: 'Invalid token payload' };
    }

    const isExpired = isTokenExpired(decoded.payload as JwtPayload);
    if (isExpired) {
      return { ok: false, error: 'Token is expired' };
    }

    return { ok: true, payload: decoded.payload as JwtPayload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Token verification failed'
    };
  }
}

/**
 * Generate a UserDO-compatible access token
 * @param userId - User ID
 * @param identifier - User identifier (email/phone)
 * @param secret - JWT secret
 * @param expiresInMinutes - Token expiration in minutes (default: 15)
 * @returns Promise resolving to signed access token
 */
export async function generateAccessToken(
  userId: string, 
  identifier: string, 
  secret: string, 
  expiresInMinutes: number = AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRY
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = Math.floor(Date.now() / 1000) + expiresInMinutes;
  return await signJWT({
    sub: userId,
    identifier: identifier.toLowerCase(),
    iat: iat,
    exp: exp,
    type: 'access'
  }, secret);
}

/**
 * Generate a UserDO-compatible refresh token
 * @param userId - User ID
 * @param identifier - User identifier (email/phone)
 * @param secret - JWT secret
 * @param expiresInDays - Token expiration in days (default: 7)
 * @returns Promise resolving to signed refresh token
 */
export async function generateRefreshToken(
  userId: string,
  identifier: string, 
  secret: string,
  expiresInMinutes: number = AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = Math.floor(Date.now() / 1000) + expiresInMinutes;
  return await signJWT({
    sub: userId,
    identifier: identifier.toLowerCase(),
    iat: iat,
    exp: exp,
    type: 'refresh'
  }, secret);
}

// II. EMAIL/PHONE
/**
 * Generate OTP code
 * @param length - OTP length (default: 6)
 * @returns OTP code string
 */
export function generateOTP(length = 6): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

/**
 * Validate email format
 * @param email - Email to validate
 * @returns Boolean indicating if email is valid
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format
 * @param phone - Phone number to validate
 * @returns Boolean indicating if phone is valid
 */
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone.replace(/\D/g, ''));
}

/**
 * Normalize identifier (email or phone)
 * @param identifier - Email or phone number
 * @returns Normalized identifier
 */
export function normalizeIdentifier(identifier: string): string {
  if (isValidEmail(identifier)) {
    return identifier.toLowerCase();
  } else if (isValidPhone(identifier)) {
    // Normalize phone number to E.164 format
    const digits = identifier.replace(/\D/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }
  return identifier.toLowerCase();
}
// III. WALLET
/**
 * Generate wallet credentials
 * @returns Object with address, privateKey, and mnemonic
 */
export async function generateWallet(encryptionSecret: string): Promise<{
  address: string;
  privateKey: string;
  mnemonicPhrase: string;
}> {
  const mnemonic = generateMnemonic(english, 256);
  const account = mnemonicToAccount(mnemonic);
  const address = account.address;
    
  // Encrypt private key and mnemonic
  const encryptedPrivateKey = CryptoJS.AES.encrypt(
    account.getHdKey().privateExtendedKey,
    encryptionSecret
  ).toString();

  const encryptedMnemonic = CryptoJS.AES.encrypt(
    mnemonic,
    encryptionSecret
  ).toString();
  
  return {
    address: address,
    privateKey: encryptedPrivateKey,
    mnemonicPhrase: encryptedMnemonic
  };
}
// IV. OAUTH

export const getSessionIdHash = (ipAddress: string, userAgent: string, secret: string) => {
  const data = `${ipAddress}|${userAgent}|${secret}`;
  return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
}

export const validateSession = ( session: any, token?: string, refreshToken?: string): void => {
  if (!session || !session.isActive) {
    throw new Error('Invalid session');
  }
  
  if (new Date(session.expiresAt) < new Date()) {
    throw new Error('Session expired');
  }
  
  if (token && session.token !== token) {
    throw new Error('Invalid token');
  }
  
  if (refreshToken && session.refreshToken !== refreshToken) {
    throw new Error('Invalid refresh token');
  }
}

// V. COOKIES
export const setCookieWithOption = (c: Context, name: string, value: string, maxAge: number) => {
  const cookieOptions = {
    sameSite: 'strict' as const, 
    httpOnly: true,
    secure: true,
    path: '/',
    domain: '.unitoken.trade',
    maxAge: maxAge,
  };
  setCookie(c, name, value, cookieOptions);
};

export const clearAuthCookies = (c: Context) => {
  deleteCookie(c, 'token', {
    path: '/',
    domain: '.unitoken.trade',
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  });
  deleteCookie(c, 'refreshToken', {
    path: '/',
    domain: '.unitoken.trade',
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  });
};

export function setAuthCookies(c: any, token: string, refreshToken: string) {
  setCookieWithOption(c, 'token', token, 10 * 60);
  setCookieWithOption(c, 'refreshToken', refreshToken, 24 * 60 * 60);
}

// V. OAUTH
export function getOAuthScopes(provider: OAuthProvider): string {
  const scopes: Record<OAuthProvider, string> = {
    google: "openid email profile",
    apple: "name email",
    facebook: "email",
    github: "user:email",
    twitter: "users.read tweet.read",
  };
  return scopes[provider];
}

export function getOAuthConfig(provider: string, env?: Env): OAuthConfig {
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
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`OAuth configuration missing for ${provider}`);
  }

  return config;
}

// --- Cập nhật hàm normalizeOAuthIdentifier với type safety ---
export function normalizeOAuthIdentifier(provider: string, userInfo: any): string {
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

