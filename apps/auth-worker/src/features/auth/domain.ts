
import { z } from 'zod';
import { SiweMessage } from 'siwe';


// II. EMAIL/PHONE

export const OTPRequestSchema = z.object({
  identifier: z.string(), // email or phone number
});

export const OTPVerificationSchema = z.object({
  identifier: z.string(),
  otp: z.string().length(6),
});


export type OTPRequest = z.infer<typeof OTPRequestSchema>;
export type OTPVerification = z.infer<typeof OTPVerificationSchema>;

// III.WALLET

export const SIWEAuthSchema = z.object({
  message: z.string(),
  signature: z.string(),
});

export type SIWEAuth = z.infer<typeof SIWEAuthSchema>;

// IV. OAUTH
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  redirectUri: string;
}

export const OAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
});

export const GoogleUserInfoSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export const AppleUserInfoSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
});

export const FacebookUserInfoSchema = z.object({
  id: z.string(),
  email: z.string().email().optional(),
  name: z.string().optional(),
});

export const GitHubUserInfoSchema = z.object({
  id: z.number(),
  email: z.string().email().nullable().optional(),
  login: z.string(),
  name: z.string().optional(),
  avatar_url: z.string().optional(),
});

export const TwitterUserInfoSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
  }),
});

export const OAuthProviderDataSchema = z.object({
  id: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  profile: z.record(z.any()).optional(),
});

// Type exports
export type OAuthProvider = "google" | "apple" | "facebook" | "github" | "twitter";
export type OAuthProviderData = z.infer<typeof OAuthProviderDataSchema>;
export type OAuthCallback = z.infer<typeof OAuthCallbackSchema>;
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
export type GoogleUserInfo = z.infer<typeof GoogleUserInfoSchema>;
export type AppleUserInfo = z.infer<typeof AppleUserInfoSchema>;
export type FacebookUserInfo = z.infer<typeof FacebookUserInfoSchema>;
export type GitHubUserInfo = z.infer<typeof GitHubUserInfoSchema>;
export type TwitterUserInfo = z.infer<typeof TwitterUserInfoSchema>;

// V. USER

// Base schemas
export const BaseUserSchema = z.object({
  identifier: z.string(), 
  role: z.enum(['member', 'admin']).default('member'),
});

export type BaseUser = z.infer<typeof BaseUserSchema>;

// User Schema
export const UserSchema = BaseUserSchema.extend({
  address: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  privateKey: z.string().optional(),
  mnemonicPhrase: z.string().optional(),
});

export type User = z.infer<typeof UserSchema>;

// Session Schema
export const SessionSchema = z.object({
  hashSessionId: z.string(),
  type: z.enum(['otp', 'siwe', 'oauth']), 
  token: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.string(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  isActive: z.boolean().default(true),
});

export type Session = z.infer<typeof SessionSchema>;

// VI. INTERFACE

export interface IUserRepository {
  get(): Promise<any>;
  save(user: User): Promise<any>;
  delete(): Promise<void>;
}

export interface IOTPService {
  generateOTP(sessionId: string): Promise<string>;
  verifyOTP(otp: string, sessionId: string): Promise<boolean>;
  sendEmailOTP(email: string, otp: string): Promise<void>;
  sendSmsOTP(phone: string, otp: string, provider: string): Promise<void>;
}

export interface IWalletService {
  generateNonceAndStore(sessionId: string): Promise<string>;
  verifySignature(sessionId: string, address: string, signature: string ): Promise<SiweMessage>;
}

export interface IOAuthService {
  generateState(sessionId: string): Promise<string>;
  exchangeOAuthCode(provider: string, sessionId: string, state: string, code: string ): Promise<OAuthTokenResponse>;
  getUserInfoFromProvider(provider: string, accessToken: string): Promise<any>;
}

export interface IKvService {
  checkRateLimit(sessionId: string): Promise<void>;
  saveNonce(sessionId: string, nonce: string): Promise<void>;
  validateNonce(sessionId: string, nonce: string): Promise<boolean>
}


