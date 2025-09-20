import jwt from '@tsndr/cloudflare-worker-jwt';
import { mnemonicToAccount, generateMnemonic, english } from 'viem/accounts'; 
import CryptoJS from 'crypto-js';

// JWT payload type matching the UserDO internal implementation
export type JwtPayload = {
  sub: string;
  identifier?: string; // Optional for refresh tokens
  exp?: number;
  iat?: number;
  type?: string; // For refresh tokens, access tokens, etc.
};

/**
 * Simple JWT decoding without verification
 * @param token - JWT token to decode
 * @returns Decoded payload or null if invalid
 */
export function decodeJWT(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));
    return payload as JwtPayload;
  } catch {
    return null;
  }
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

    return { ok: true, payload: decoded.payload as JwtPayload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Token verification failed'
    };
  }
}

/**
 * Hash identifier for ID generation
 * @param identifier - Email or phone number to hash
 * @returns Promise resolving to hex hash string
 */
export async function hashIdentifierForId(identifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(identifier.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return hashHex;
}

/**
 * Check if token is expired
 * @param payload - JWT payload
 * @returns true if token is expired
 */
export function isTokenExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  return payload.exp < Math.floor(Date.now() / 1000);
}

/**
 * Extract identifier from token
 * @param token - JWT token
 * @returns Identifier string or null if not found
 */
export function getIdentifierFromToken(token: string): string | null {
    const payload = decodeJWT(token);
    return payload?.identifier?.toLowerCase() || null;
}

/**
 * Sign a JWT token with the given payload and secret
 * @param payload - JWT payload
 * @param secret - JWT secret
 * @returns Promise resolving to signed token
 */
export async function signJWT(payload: JwtPayload, secret: string): Promise<string> {
  return await jwt.sign(payload, secret);
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
  expiresInMinutes: number = 15
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;
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
  expiresInDays: number = 7
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 24 * 60 * 60;
  return await signJWT({
    sub: userId,
    identifier: identifier.toLowerCase(),
    iat: iat,
    exp: exp,
    type: 'refresh'
  }, secret);
}

/**
 * Verify tokens with automatic refresh - decodes identifier from expired access token
 * @param token - Current access token (may be expired)
 * @param refreshToken - Refresh token (optional)
 * @param secret - JWT secret
 * @returns Verification result with payload and new token if refreshed
 */
export async function verifyTokens(
  token: string,
  refreshToken: string | undefined,
  secret: string
): Promise<{
  ok: boolean;
  payload?: JwtPayload;
  newToken?: string;
  error?: string;
}> {
  // Try current token first
  const result = await verifyJWT(token, secret);
  if (result.ok && result.payload) {
    return { ok: true, payload: result.payload };
  }

  // If token failed and we have refresh token, try refresh
  if (refreshToken) {
    try {
      // Decode (but don't verify) the expired access token to get identifier
      const decodedToken = decodeJWT(token);
      const identifier = decodedToken?.identifier;

      if (!identifier) {
        return { ok: false, error: 'Cannot decode identifier from access token' };
      }

      const refreshResult = await verifyJWT(refreshToken, secret);

      if (refreshResult.ok && refreshResult.payload) {
        // Ensure it's a refresh token
        if (refreshResult.payload.type !== 'refresh') {
          return { ok: false, error: 'Invalid refresh token type' };
        }

        const userId = refreshResult.payload.sub;

        // Generate new access token using decoded identifier
        const newToken = await generateAccessToken(userId, identifier, secret);

        return {
          ok: true,
          payload: { sub: userId, identifier },
          newToken
        };
      }
    } catch (e) {
      return { ok: false, error: 'Token refresh failed' };
    }
  }

  return { ok: false, error: 'Token verification failed' };
}

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
