import { UserDO } from '../ws/infrastructure/UserDO';
import { handleError } from '../../shared/utils';
import { SiweMessage, generateNonce } from 'siwe';

import { User, UserSchema, IUserRepository, IOTPService, IWalletService, IOAuthService, IKvService,
          OAuthTokenResponse, OAuthTokenResponseSchema,
          GoogleUserInfoSchema, AppleUserInfoSchema, FacebookUserInfoSchema, GitHubUserInfoSchema, TwitterUserInfoSchema,
          Session, SessionSchema } from './domain';
import { AUTH_CONSTANTS } from './constants';
import { getOAuthConfig, generateOTP } from './utils';

export function createRepository(userDO: UserDO) {
  const users = userDO.table('users', UserSchema, { userScoped: true });
  const sessions = userDO.table('sessions', SessionSchema, { userScoped: true });

  const userRepository: IUserRepository = {
    async get(): Promise<any> {
      return await users.limit(1).first();
    },

    async save(user: User): Promise<any> {
      const validUser = UserSchema.parse(user);
      const existingUser = await users.limit(1).first();
      if (existingUser) {
        return await users.update(existingUser.id, validUser);
      } else {
        return await users.create(validUser);
      }
    },

    async delete(): Promise<void> {
      const user = await users.limit(1).first();
      if (user) {
        await users.delete(user.id);
      }
    },
  };

  return {
    users: userRepository,
    sessions: {
      async create(sessionData: Session): Promise<void> {
        const validSession = SessionSchema.parse(sessionData);
        await sessions.create(validSession);
      },

      async findById(sessionId: string): Promise<Session | null> {
        const session = await sessions.findById(sessionId);
        return session ? SessionSchema.parse(session) : null;
      },

      async update(sessionId: string, sessionData: Partial<Session>): Promise<void> {
        const existingSession = await sessions.findById(sessionId);
        if (existingSession) {
          const updatedSession = { ...existingSession, ...sessionData };
          const validSession = SessionSchema.parse(updatedSession);
          await sessions.update(sessionId, validSession);
        }
      },

      async delete(sessionId: string): Promise<void> {
        await sessions.delete(sessionId);
      }, 
      async deactivateAllUserSessions(userId: string): Promise<void> {
        const userSessions = await sessions.where('userId', '==', userId).get();
        
        for (const session of userSessions) {
          await sessions.update(session.id, { ...session, isActive: false });
        }
      },
      async updateSession(sessionId: string, token: string, refreshToken: string): Promise<void> {
        const session = await sessions.findById(sessionId);
        if (session) {
          await sessions.update(sessionId, { ...session, token, refreshToken, isActive: true, expiresAt: new Date(Date.now() + AUTH_CONSTANTS.SESSION_EXPIRY * 1000).toISOString() });
        }
      },    

    }
  };
}

export function createOTPService(env: Env): IOTPService {
  const kvService = createKvService(env);
  return {
    async generateOTP(sessionId: string): Promise<string> {
      const otp = generateOTP();
      kvService.saveNonce(sessionId, otp);      
      return otp;       
    },

    async verifyOTP(otp: string, sessionId: string): Promise<boolean> {
      return await kvService.validateNonce(sessionId, otp);
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
            const smsData = new URLSearchParams({
              from: env.SMS_FROM_NUMBER,
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

export function createWalletService(env: Env): IWalletService {
  const kvService = createKvService(env);
  
  return {
    async generateNonceAndStore(sessionId: string): Promise<string> {
      const nonce = generateNonce();
      kvService.saveNonce(sessionId, nonce);      
      return nonce; 
    },

    async verifySignature(sessionId: string, message: string, signature: string): Promise<SiweMessage> {
      const siweMessage = new SiweMessage(message);
      const sig = signature.startsWith('0x') ? signature : `0x${signature}`;
      const { data: fields } = await siweMessage.verify({ signature: sig });
      const isValid= await kvService.validateNonce(sessionId, fields.nonce);
      if (!isValid) {
        throw new Error('Invalid nonce');
      }
      return fields;
    }
  };
}

export function createOAuthService(env: Env): IOAuthService {
  const kvService = createKvService(env);
  return {
    async generateState(sessionId: string): Promise<string> {
      const state = generateNonce();
      kvService.saveNonce(sessionId, state);
      return state; 
    },

    async exchangeOAuthCode(provider: string, sessionId: string, state: string, code: string): Promise<OAuthTokenResponse> {
      const isValidNonce = await kvService.validateNonce(sessionId, state);
      if (!isValidNonce) {
        throw new Error('OAUTH: Invalid nonce');
      }

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
          'Accept': 'application/json',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OAuth token exchange failed: ${errorText}`);
      }

      const tokenData = await response.json();

      return OAuthTokenResponseSchema.parse(tokenData); 
    },

    async getUserInfoFromProvider(provider: string, accessToken: string): Promise<any> {
      try {
        const config = getOAuthConfig(provider, env);
        const response = await fetch(config.userInfoEndpoint, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'User-Agent': 'YourAppName',
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

  };
}

export function createKvService(env: any): IKvService {
  return {
    async checkRateLimit(sessionId: string): Promise<void> {
      const now = Date.now();
      
      const recordStr = await env.NONCE_KV.get(`RateLimit:${sessionId}`);
      const record = recordStr ? JSON.parse(recordStr) : null;

      if (record && record.resetAt > now) {
        if (record.count >= AUTH_CONSTANTS.RATE_LIMIT_MAX) {
          throw new Error('Too many requests');
        }

        record.count += 1;
        await env.NONCE_KV.put(
          `RateLimit:${sessionId}`,
          JSON.stringify(record),
          {
            expirationTtl: AUTH_CONSTANTS.RATE_LIMIT_WINDOW / 1000,
          }
        );
      } else {
        const resetAt = now + AUTH_CONSTANTS.RATE_LIMIT_WINDOW;
        const newRecord = { count: 1, resetAt };
        await env.NONCE_KV.put(
          `RateLimit:${sessionId}`,
          JSON.stringify(newRecord),
          {
            expirationTtl: AUTH_CONSTANTS.RATE_LIMIT_WINDOW / 1000,
          }
        );
      }
    },
    async saveNonce(sessionId: string, nonce: string): Promise<void> {
      const nonceData = {
        nonce,
        used: false
      };

      await env.NONCE_KV.put(
        `Nonce:${sessionId}`,
        JSON.stringify(nonceData),
        {
          expirationTtl: AUTH_CONSTANTS.NONCE_EXPIRY,
        }
      );
    },

    async validateNonce(sessionId: string, nonce: string): Promise<boolean> {
      const nonceStr = await env.NONCE_KV.get(`Nonce:${sessionId}`);
      
      if (!nonceStr) {
        throw new Error('Nonce not found');
      }

      const nonceData = JSON.parse(nonceStr);
      
      // Kiểm tra nonce đã được sử dụng chưa
      if (nonceData.used) {
        throw new Error('Nonce has been used');
      }

      // Đánh dấu nonce đã được sử dụng
      nonceData.used = true;
      await env.NONCE_KV.put(
        `Nonce:${nonce}`,
        JSON.stringify(nonceData),
        {
          expirationTtl: AUTH_CONSTANTS.NONCE_EXPIRY,
        }
      );

      return nonceData.nonce === nonce;
    }  
  };
}