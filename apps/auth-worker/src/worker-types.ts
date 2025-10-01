import { z } from 'zod';

// Request/Response schemas for typed endpoints
export const OTPRequestSchema = z.object({
  identifier: z.string(), // email or phone number
});

export const OTPVerificationSchema = z.object({
  identifier: z.string(),
  otp: z.string().length(6),
});

// --- Thêm schema mới cho SIWE ---
export const SIWENonceSchema = z.object({
  nonce: z.string(),
});

export const SIWEAuthSchema = z.object({
  message: z.string(),
  signature: z.string(),
});

export const SetDataRequestSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

export const GetDataRequestSchema = z.object({
  key: z.string(),
});


// Response schemas
export const AuthResponseSchema = z.object({
  success: z.literal(true),
  user: z.object({
    id: z.string(),
    identifier: z.string(),
    address: z.string(),
  }),
});

export const OTPResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});

export const SIWENonceResponseSchema = z.object({
  nonce: z.string(),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const SuccessResponseSchema = z.object({
  ok: z.literal(true),
});

export const DataResponseSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

export const EventsResponseSchema = z.array(z.object({
  event: z.string(),
  data: z.unknown(),
  timestamp: z.number(),
}));

// --- Thêm schema và types cho OAuth ---
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

// Type exports
export type OAuthCallback = z.infer<typeof OAuthCallbackSchema>;
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
export type GoogleUserInfo = z.infer<typeof GoogleUserInfoSchema>;
export type AppleUserInfo = z.infer<typeof AppleUserInfoSchema>;
export type FacebookUserInfo = z.infer<typeof FacebookUserInfoSchema>;
export type GitHubUserInfo = z.infer<typeof GitHubUserInfoSchema>;
export type TwitterUserInfo = z.infer<typeof TwitterUserInfoSchema>;

export type OTPRequest = z.infer<typeof OTPRequestSchema>;
export type OTPVerification = z.infer<typeof OTPVerificationSchema>;
export type SIWENonce = z.infer<typeof SIWENonceSchema>;
export type SIWEAuth = z.infer<typeof SIWEAuthSchema>;
export type SetDataRequest = z.infer<typeof SetDataRequestSchema>;
export type GetDataRequest = z.infer<typeof GetDataRequestSchema>;

export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type OTPResponse = z.infer<typeof OTPResponseSchema>;
export type SIWENonceResponse = z.infer<typeof SIWENonceResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type DataResponse = z.infer<typeof DataResponseSchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

// Endpoint definitions for OpenAPI/documentation
export interface UserDOEndpoints {
  'GET /api/wallet/nonce': {
    response: SIWENonceResponse | ErrorResponse;
  };
  'POST /api/wallet/connect': {
    body: SIWEAuth;
    response: AuthResponse | ErrorResponse;
  };
  'POST /api/otp/request': {
    body: OTPRequest;
    response: OTPResponse | ErrorResponse;
  };
  'POST /api/otp/verify': {
    body: OTPVerification;
    response: AuthResponse | ErrorResponse;
  };
  'POST /api/logout': {
    response: SuccessResponse;
  };
  'GET /api/me': {
    response: { user: AuthResponse['user'] } | ErrorResponse;
  };
  'GET /api/events': {
    query: { since?: string };
    response: EventsResponse | ErrorResponse;
  };
  'GET /data': {
    body: GetDataRequest;
    response: DataResponse | ErrorResponse;
  };
  'POST /data': {
    body: SetDataRequest;
    response: DataResponse | ErrorResponse;
  };
  'GET /protected/profile': {
    response: { ok: true; user: AuthResponse['user'] } | ErrorResponse;
  };
  'GET /api/oauth/:provider/url': {
    response: { url: string } | ErrorResponse;
  };
  'GET /api/oauth/:provider/callback': {
    query: OAuthCallback;
    response: never; // Redirect response
  };
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  redirectUri: string;
}

export type OAuthProvider = "google" | "apple" | "facebook" | "github" | "twitter";
// Helper type for extracting endpoint types
export type EndpointRequest<T extends keyof UserDOEndpoints> =
  UserDOEndpoints[T] extends { body: infer B } ? B : never;

export type EndpointResponse<T extends keyof UserDOEndpoints> =
  UserDOEndpoints[T]['response'];

export type EndpointQuery<T extends keyof UserDOEndpoints> =
  UserDOEndpoints[T] extends { query: infer Q } ? Q : never;