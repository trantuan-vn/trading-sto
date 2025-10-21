import { handleError } from '../../shared/utils';
import { SiweMessage, generateNonce } from 'siwe';

import { User, IUserRepository, IOTPService, IWalletService, IOAuthService, IRateLimitService,
          OAuthTokenResponse, OAuthTokenResponseSchema,
          GoogleUserInfoSchema, AppleUserInfoSchema, FacebookUserInfoSchema, GitHubUserInfoSchema, TwitterUserInfoSchema } from './domain';
import { AUTH_CONSTANTS } from './constants';
import { getOAuthConfig, generateOTP } from './utils';

export function createUserRepository( storage: DurableObjectStorage): IUserRepository 
{
  return {
    async get(): Promise<User | undefined> {
      return await storage.get<User>(AUTH_CONSTANTS.AUTH_DATA_KEY);
    },

    async save(user: User): Promise<void> {
      await storage.put(AUTH_CONSTANTS.AUTH_DATA_KEY, user);
    },

    async delete(): Promise<void> {
      await storage.delete(AUTH_CONSTANTS.AUTH_DATA_KEY);
    },
  };
}

export function createOTPService(env: any): IOTPService {
  return {
    async generateOTP(): Promise<{ otp: string; sessionId: string }> {
      const otp = generateOTP();
      const sessionId = crypto.randomUUID();
      const rec = { otp, issuedAt: Date.now() };
      await env.NONCE_KV.put(`otp:${sessionId}`, JSON.stringify(rec), { expirationTtl: 300 });
      return { otp, sessionId };
    },

    async verifyOTP(otp: string, sessionId: string): Promise<boolean> {
      const rec = await env.NONCE_KV.get(`otp:${sessionId}`);
      if (!rec || Date.now() - rec.issuedAt > 10 * 60 * 1000 || rec.otp != otp) return false;
      await env.NONCE_KV.delete(`otp:${sessionId}`);
      return true;
    },

    async sendEmailOTP(email: string, otp: string): Promise<void> {
      const emailData = {
        personalizations: [{ to: [{ email }], subject: "Your OTP Code" }],
        from: { email: "noreply@unitoken.trade", name: "Unitoken Auth" },
        content: [{
          type: "text/html",
          value: `
            <h2>Your OTP Code</h2>
            <p>Your one-time password is: <strong>${otp}</strong></p>
            <p>This code will expire in 10 minutes.</p>
          `
        }],
      };

      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.EMAIL_API_KEY}`,
        },
        body: JSON.stringify(emailData),
      });

      if (!response.ok) {
        console.error("Failed to send email OTP:", await response.text());
      }
    },

    async sendSmsOTP(phone: string, otp: string, provider: string) {
      try {
        let response: Response | null = null;

        switch (provider.toUpperCase()) {
          case "TWILIO": {
            const smsData = new URLSearchParams({
              To: phone,
              From: env.SMS_FROM_NUMBER,
              Body: `Your OTP code is: ${otp}. This code will expire in 10 minutes.`,
            });

            const accountSid = env.TWILIO_ACCOUNT_SID;
            const authToken = env.TWILIO_AUTH_TOKEN;

            response = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
              {
                method: "POST",
                headers: {
                  "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: smsData.toString(),
              }
            );
            break;
          }
          case "VONAGE": {
            // Vonage (Nexmo) SMS API dùng form-urlencoded và basic auth
            const smsData = new URLSearchParams({
              from: env.SMS_FROM_NUMBER, // hoặc Sender ID
              to: phone,
              text: `Your OTP code is: ${otp}. This code will expire in 10 minutes.`,
            });

            response = await fetch("https://rest.nexmo.com/sms/json", {
              method: "POST",
              headers: {
                "Authorization": "Basic " + btoa(`${env.VONAGE_API_KEY}:${env.VONAGE_API_SECRET}`),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: smsData.toString(),
            });        
            break;
          }

          default:
            throw new Error(`Unsupported provider: ${provider}`);
        }

        if (response && !response.ok) {
          console.error(`Failed to send SMS OTP via ${provider}:`, await response.text());
        }
      } catch (error) {
        console.error(`Error sending SMS OTP via ${provider}:`, error);
      }
    }    
  };
}

export function createWalletService(env: any): IWalletService {
  return {
    async generateNonceAndStore(): Promise<{ nonce: string; sessionId: string }> {
      const nonce = generateNonce();
      const sessionId = crypto.randomUUID();
      
      const rec = { nonce, issuedAt: Date.now() };
      await env.NONCE_KV.put(`siwe:${sessionId}`, JSON.stringify(rec), { expirationTtl: 300 });

      return { nonce, sessionId }; 
    },
    async verifySignature(sessionId: string, message: string, signature: string): Promise<SiweMessage> {
        
      const rec = await env.NONCE_KV.get(`siwe:${sessionId}`);

      if (!rec) {
        throw new Error("Session not found");
      }

      // Verify SIWE
      const siweMessage = new SiweMessage(message);

      const sig = signature.startsWith("0x") ? signature : `0x${signature}`;
      const { data: fields } = await siweMessage.verify({ signature: sig });

      // Kiểm tra nonce khớp
      if (fields.nonce !== rec.nonce) {
        throw new Error("Invalid nonce");
      }

      // Check expiry (5 phút)
      if (Date.now() - rec.issuedAt > 5 * 60 * 1000) {
        await env.NONCE_KV.delete(`siwe:${sessionId}`);
        throw new Error("Nonce expired");
      }

      // Mark nonce used and delete
      await env.NONCE_KV.delete(`siwe:${sessionId}`);
      
      return fields;
    }
  }
}

export function createOAuthService(env: any): IOAuthService {
  return {
    async generateState(): Promise<{ state: string; sessionId: string }> {
      try {
        const state = generateNonce();
        const sessionId = crypto.randomUUID();
        const rec = { state, issuedAt: Date.now() };
        await env.NONCE_KV.put(`oauth:${sessionId}`, JSON.stringify(rec), { expirationTtl: 300 });
        return { state, sessionId };
      } catch (e) {
        const { errorResponse, status } = handleError(e, "Failed to generate OAuth state");
        throw { errorResponse, status };
      }  
    },
    async exchangeOAuthCode(provider: string, sessionId: string,  state: string, code: string ): Promise<OAuthTokenResponse> {
        
      const rec = await env.NONCE_KV.get(`oauth:${sessionId}`);
      if (!rec || rec.state !== state) {
        throw new Error(`OAuth token exchange failed for ${provider}: Invalid state`);
      }

      try {
        const config = getOAuthConfig(provider, env);
        const params = new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
        });

        const response = await fetch(config.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json', // Request JSON response
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OAuth token exchange failed: ${errorText}`);
        }

        const tokenData = await response.json();

        await env.NONCE_KV.delete(`oauth:${sessionId}`);

        return OAuthTokenResponseSchema.parse(tokenData);
      } catch (e) {
        const { errorResponse, status } = handleError(e, `OAuth token exchange failed for ${provider}`);
        throw { errorResponse, status };
      }  
    },
    async getUserInfoFromProvider(provider: string, accessToken: string): Promise<any> {
      try 
      {
        const config = getOAuthConfig(provider, env);
        const response = await fetch(config.userInfoEndpoint, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'User-Agent': 'YourAppName', // Added for GitHub compatibility
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to get user info from ${provider}: ${response.status} ${errorText}`);
        }

        const contentType = response.headers.get('content-type') || '';

        if (!contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Unexpected response format from ${provider}: ${contentType}`);
        }

        const userInfo = await response.json();

        // Validate user info based on provider
        let validatedUserInfo: any;
        switch (provider) {
          case 'google':
            validatedUserInfo = GoogleUserInfoSchema.parse(userInfo);
            break;
          case 'apple':
            validatedUserInfo = AppleUserInfoSchema.parse(userInfo);
            break;
          case 'facebook':
            validatedUserInfo = FacebookUserInfoSchema.parse(userInfo);
            break;
          case 'github':
            validatedUserInfo = GitHubUserInfoSchema.parse(userInfo);
            break;
          case 'twitter':
            validatedUserInfo = TwitterUserInfoSchema.parse(userInfo);
            break;
          default:
            throw new Error(`Unsupported provider: ${provider}`);
        }

        return validatedUserInfo;

      } catch (e) {
        const { errorResponse, status } = handleError(e, `Failed to get user info from ${provider}`);
        throw { errorResponse, status };
      }      
    }
  }
}

export function createRateLimitService(storage: DurableObjectStorage): IRateLimitService {
  return {
    async checkRateLimit(): Promise<void> {
      const now = Date.now();
      const record = await storage.get<{
        count: number;
        resetAt: number;
      }>(AUTH_CONSTANTS.RATE_LIMIT_KEY);
      
      if (record && record.resetAt > now) {
        if (record.count >= AUTH_CONSTANTS.RATE_LIMIT_MAX) {
          throw new Error('Too many requests');
        }
        record.count += 1;
        await storage.put(AUTH_CONSTANTS.RATE_LIMIT_KEY, record);
      } else {
        const resetAt = now + AUTH_CONSTANTS.RATE_LIMIT_WINDOW;
        await storage.put(AUTH_CONSTANTS.RATE_LIMIT_KEY, { count: 1, resetAt });
      }
    }
  };
}

export function createKvRateLimitService(env: any): IRateLimitService {
  return {
    async checkRateLimit(): Promise<void> {
      const now = Date.now();
      const record = await env.NONCE_KV.get(AUTH_CONSTANTS.RATE_LIMIT_KEY);
      
      if (record && record.resetAt > now) {
        if (record.count >= AUTH_CONSTANTS.RATE_LIMIT_MAX) {
          throw new Error('Too many requests');
        }
        record.count += 1;
        await env.NONCE_KV.put(AUTH_CONSTANTS.RATE_LIMIT_KEY, record);
      } else {
        const resetAt = now + AUTH_CONSTANTS.RATE_LIMIT_WINDOW;
        await env.NONCE_KV.put(AUTH_CONSTANTS.RATE_LIMIT_KEY, { count: 1, resetAt });
      }
    }
  };
}

