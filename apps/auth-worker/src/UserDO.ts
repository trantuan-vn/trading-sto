import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import jwt, { JwtData } from '@tsndr/cloudflare-worker-jwt';
import { UserDODatabase, TableOptions } from './database/index.js';

import { 
    generateOTP, 
    generateWallet, 
    isValidEmail, 
    isValidPhone, 
    normalizeIdentifier, 
    generateRefreshToken,
    generateAccessToken,
    type JwtPayload
} from './jwt-utils.js';

// --- Cập nhật User Schema với OAuth data chi tiết hơn ---
const OAuthProviderDataSchema = z.object({
  id: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  profile: z.record(z.any()).optional(), // Lưu thêm thông tin profile
});
// --- User Schema ---
const UserSchema = z.object({
    id: z.string(),
    identifier: z.string(), // address or email or phone number
    otp: z.string().optional(),
    otpExpires: z.number().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    privateKey: z.string().optional(),
    mnemonicPhrase: z.string().optional(),
    createdAt: z.string(),
    refreshTokens: z.array(z.string()).default([]),
    oauthData: z.record(OAuthProviderDataSchema).optional(),
});

// --- OTP Request Schema ---
const OTPRequestSchema = z.object({
    identifier: z.string(),
});

// --- OTP Verification Schema ---
const OTPVerificationSchema = z.object({
    identifier: z.string(),
    otp: z.string().length(6),
});

// --- Wallet Connect Schema ---
const WalletConnectSchema = z.object({
    address: z.string(),
    signature: z.string(),
});

export type User = z.infer<typeof UserSchema>;

// --- Organization Schemas ---
const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  ownerId: z.string(), // tham chiếu User.id
  createdAt: z.string(),
});

const OrganizationMemberSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),       // tham chiếu User.id
  identifier: z.string(),   // đồng bộ với UserSchema.identifier (email/phone)
  role: z.enum(['admin', 'member']), // owner là implicit
  createdAt: z.string(),
});

const OrganizationMembershipSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  ownerIdentifier: z.string(), // thay vì ownerEmail -> ownerIdentifier
  role: z.enum(['admin', 'member']),
  joinedAt: z.string(),
});


type Organization = z.infer<typeof OrganizationSchema>;
type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;

// --- Zod Schemas for endpoint validation ---
const InitSchema = UserSchema;

const RESERVED_PREFIX = "__";
const AUTH_DATA_KEY = "__user";
const RATE_LIMIT_KEY = "__rl";
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const OTP_EXPIRY = 10 * 60 * 1000; // 10 minutes

function isReservedKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX);
}

// Hash identifier for use as DO ID
export async function hashIdentifierForId(identifier: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalizeIdentifier(identifier));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return hashHex;
}

// Helper function to get UserDO 
// Maintains the same API as env.MY_APP_DO.get(env.MY_APP_DO.idFromName(email))
export function getUserDO<T extends UserDO>(
  namespace: DurableObjectNamespace<T>,
  identifier: string
): T {
  return namespace.get(namespace.idFromName(normalizeIdentifier(identifier))) as unknown as T;
}

const getDO = (env: Env, identifier: string): UserDO => {
  return env.USERDO.get(env.USERDO.idFromName(normalizeIdentifier(identifier))) as unknown as UserDO;
};

export async function migrateUserIdentifier(
  { env, oldIdentifier, newIdentifier }:
    { env: Env; oldIdentifier: string; newIdentifier: string }
): Promise<{ ok: boolean; error?: string }> {
  oldIdentifier = oldIdentifier.toLowerCase();
  newIdentifier = newIdentifier.toLowerCase();
  const oldDO = getDO(env, oldIdentifier);
  const newDO = getDO(env, newIdentifier);
  try {
    const user = await oldDO.raw();
    user.identifier = newIdentifier;
    await newDO.init(user);
    await oldDO.deleteUser();
    return { ok: true };
  } catch (err) {
    // Optionally, add rollback logic here
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export class UserDO extends DurableObject {
  protected state: DurableObjectState;
  protected storage: DurableObjectStorage;
  protected env: Env;
  protected database: UserDODatabase;

  // Organization tables (for organizations I OWN)
  protected ownedOrganizations: any;
  protected organizationMembers: any;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.database = new UserDODatabase(
      this.storage,
      this.getCurrentUserId(),
      this.broadcast.bind(this)
    );

    // Initialize organization tables
    this.ownedOrganizations = this.table('owned_organizations', OrganizationSchema, { userScoped: true });
    this.organizationMembers = this.table('organization_members', OrganizationMemberSchema, { userScoped: true });
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const record = await this.storage.get<{
      count: number;
      resetAt: number
    }>(RATE_LIMIT_KEY);
    if (record && record.resetAt > now) {
      if (record.count >= RATE_LIMIT_MAX) {
        throw new Error('Too many requests');
      }
      record.count += 1;
      await this.storage.put(RATE_LIMIT_KEY, record);
    } else {
      const resetAt = now + RATE_LIMIT_WINDOW;
      await this.storage.put(RATE_LIMIT_KEY, { count: 1, resetAt });
    }
  }

  private async generateTokens(user: User): Promise<{ token: string; refreshToken: string }> {
    const now = Math.floor(Date.now() / 1000);
    // Access token (15 phút)
    const token = await generateAccessToken(user.id, user.identifier, this.env.JWT_SECRET);
    // Refresh token (7 ngày)
    const refreshToken = await generateRefreshToken(user.id, user.identifier, this.env.JWT_SECRET);

    return { token, refreshToken };
  }

  async requestOTP({ identifier }: { identifier: string }) {
    identifier = normalizeIdentifier(identifier);
    await this.checkRateLimit();

    const parsed = OTPRequestSchema.safeParse({ identifier });
    if (!parsed.success) {
        throw new Error('Invalid input: ' + JSON.stringify(parsed.error.flatten()));
    }

    // Check if identifier is valid email or phone
    if (!isValidEmail(identifier) && !isValidPhone(identifier)) {
        throw new Error('Invalid email or phone number');
    }

    const otp = generateOTP();
    const otpExpires = Date.now() + OTP_EXPIRY;

    // Check if user already exists
    let user = await this.storage.get(AUTH_DATA_KEY) as User;
    
    if (user) {
        // Update existing user's OTP
        user.otp = otp;
        user.otpExpires = otpExpires;
    } else {
        // Create new user with wallet
        const id = this.state.id.toString();
        const createdAt = new Date().toISOString();
        
        user = {
            id,
            identifier,
            otp,
            otpExpires,
            createdAt,
            refreshTokens: []
        };
    }

    await this.storage.put(AUTH_DATA_KEY, user);

    // Send OTP via email or SMS based on identifier type
    if (isValidEmail(identifier)) {
        // Send OTP via email
        await this.sendEmailOTP(identifier, otp);
        console.log(`OTP sent to email ${identifier}: ${otp}`);
    } else if (isValidPhone(identifier)) {
        // Send OTP via SMS
        await this.sendSMSOTP(identifier, otp, "VONAGE");
        console.log(`OTP sent to phone ${identifier}: ${otp}`);
    }

    return { ok: true, message: 'OTP sent successfully' };
  }

  // Email sending implementation 
  private async sendEmailOTP(email: string, otp: string) {
    try {
      const emailData = {
        personalizations: [
          {
            to: [{ email }],
            subject: "Your OTP Code",
          },
        ],
        from: {
          email: "noreply@unitoken.trade", // phải là domain đã verify trong SendGrid
          name: "Unitoken Auth",           // tên hiển thị
        },
        content: [
          {
            type: "text/html",
            value: `
              <h2>Your OTP Code</h2>
              <p>Your one-time password is: <strong>${otp}</strong></p>
              <p>This code will expire in 10 minutes.</p>
              <p>If you didn't request this, please ignore this email.</p>
            `,
          },
        ],
      };

      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.EMAIL_API_KEY}`, // thay bằng key SendGrid thật
        },
        body: JSON.stringify(emailData),
      });

      if (!response.ok) {
        console.error("Failed to send email OTP:", await response.text());
      } else {
        console.log("OTP email sent to", email);
      }
    } catch (error) {
      console.error("Error sending email OTP:", error);
    }
  }


  // SMS sending implementation
private async sendSMSOTP(phone: string, otp: string, provider: string) {
  try {
    let response: Response | null = null;

    switch (provider.toUpperCase()) {
      case "TWILIO": {
        const smsData = new URLSearchParams({
          To: phone,
          From: this.env.SMS_FROM_NUMBER,
          Body: `Your OTP code is: ${otp}. This code will expire in 10 minutes.`,
        });

        const accountSid = this.env.TWILIO_ACCOUNT_SID;
        const authToken = this.env.TWILIO_AUTH_TOKEN;

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
          from: this.env.SMS_FROM_NUMBER, // hoặc Sender ID
          to: phone,
          text: `Your OTP code is: ${otp}. This code will expire in 10 minutes.`,
        });

        response = await fetch("https://rest.nexmo.com/sms/json", {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${this.env.VONAGE_API_KEY}:${this.env.VONAGE_API_SECRET}`),
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


  async verifyOTP({ identifier, otp }: { identifier: string; otp: string }) {
    identifier = normalizeIdentifier(identifier);
    await this.checkRateLimit();

    const parsed = OTPVerificationSchema.safeParse({ identifier, otp });
    if (!parsed.success) {
        throw new Error('Invalid input: ' + JSON.stringify(parsed.error.flatten()));
    }

    const user = await this.storage.get(AUTH_DATA_KEY) as User;
    if (!user || user.identifier !== identifier) {
        throw new Error('Invalid credentials');
    }

    // Check OTP
    if (user.otp !== otp || !user.otpExpires || user.otpExpires < Date.now()) {
        throw new Error('Invalid or expired OTP');
    }

    // Clear OTP after successful verification
    user.otp = undefined;
    user.otpExpires = undefined;
    // Update email
    if (isValidEmail(identifier)) {
      user.email = identifier;
    } 
    // Update phone
    if (isValidPhone(identifier)) {
      user.phone = identifier;    
    }
    // update wallet
    const wallet=await generateWallet(this.env.ENCRYPTION_SECRET);
    user.address=wallet.address;
    user.privateKey=wallet.privateKey;
    user.mnemonicPhrase=wallet.mnemonicPhrase;    
    // Update user
    await this.storage.put(AUTH_DATA_KEY, user);

    const { token, refreshToken } = await this.generateTokens(user);

    // Store refresh token
    user.refreshTokens.push(refreshToken);
    await this.storage.put(AUTH_DATA_KEY, user);

    return { user, token, refreshToken };
  }

  async connectWallet({ address, signature }: { address: string; signature: string }) {
    await this.checkRateLimit();

    const parsed = WalletConnectSchema.safeParse({ address, signature });
    if (!parsed.success) {
        throw new Error('Invalid input: ' + JSON.stringify(parsed.error.flatten()));
    }

    // In a real implementation, verify the signature here
    // For demo purposes, we'll assume the signature is valid

    const id = this.state.id.toString();
    const createdAt = new Date().toISOString();

    const user = {
        id: id,
        identifier: address,
        address: address,
        createdAt: createdAt,
        refreshTokens: [] as string[]
    };

    await this.storage.put(AUTH_DATA_KEY, user);

    const { token, refreshToken } = await this.generateTokens(user);

    // Store refresh token
    user.refreshTokens.push(refreshToken);
    await this.storage.put(AUTH_DATA_KEY, user);

    return { user, token, refreshToken };
  }

  async raw(): Promise<User> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');
    return user;
  }

  async init(user: User): Promise<{ ok: boolean }> {
    const parsed = InitSchema.safeParse(user);
    if (!parsed.success) {
      throw new Error('Invalid input: ' + JSON.stringify(parsed.error.flatten()));
    }
    await this.storage.put(AUTH_DATA_KEY, user);
    return { ok: true };
  }

  async deleteUser(): Promise<{ ok: boolean }> {
    await this.storage.delete(AUTH_DATA_KEY);
    return { ok: true };
  }

  async verifyToken(
    { token }: { token: string }
  ): Promise<{
    ok: boolean;
    user?: User
    error?: string
  }> {
    try {
      const verify = await jwt.verify(
        token, this.env.JWT_SECRET
      ) as JwtData<JwtPayload, {}>;
      if (!verify) throw new Error('Invalid token');
      const { payload } = verify;
      if (!payload) throw new Error('Invalid token');

      const { sub, identifier } = { sub: payload.sub, identifier: payload.identifier };

      if (!sub || !identifier) throw new Error('Invalid token');

      const user = await this.storage.get<User>(AUTH_DATA_KEY);
      if (!user) throw new Error('User not found');
      if (payload.sub !== user.id) {
        throw new Error('Token subject mismatch');
      }
      return { ok: true, user: user };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async set(
    key: string,
    value: unknown
  ): Promise<{ ok: boolean }> {
    if (isReservedKey(key)) {
      throw new Error(`Key "${key}" is reserved`);
    }
    await this.storage.put(key, value);
    this.broadcast(`kv:${key}`, value);
    return { ok: true };
  }

  async get(
    key: string
  ): Promise<unknown> {
    if (isReservedKey(key)) {
      throw new Error(`Key "${key}" is reserved`);
    }
    return await this.storage.get(key);
  }

  async refreshToken(
    { refreshToken }: { refreshToken: string }
  ): Promise<{ token: string }> {
    try {
      const verify = await jwt.verify(
        refreshToken, this.env.JWT_SECRET
      ) as JwtData<JwtPayload & { type: string }, {}>;

      if (!verify || !verify.payload || verify.payload.type !== 'refresh') {
        throw new Error('Invalid refresh token');
      }

      const user = await this.storage.get<User>(AUTH_DATA_KEY);
      if (!user) throw new Error('User not found');

      // Verify refresh token is in user's list
      if (!user.refreshTokens.includes(refreshToken)) {
        throw new Error('Refresh token not found');
      }

      // Generate new access token
      const token = await generateAccessToken(user.id, user.identifier, this.env.JWT_SECRET);

      return { token };
    } catch (err) {
      throw new Error('Invalid refresh token');
    }
  }

  async revokeRefreshToken(
    { refreshToken }: { refreshToken: string }
  ): Promise<{ ok: boolean }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
    await this.storage.put(AUTH_DATA_KEY, user);
    return { ok: true };
  }

  async revokeAllRefreshTokens(): Promise<{ ok: boolean }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    user.refreshTokens = [];
    await this.storage.put(AUTH_DATA_KEY, user);
    return { ok: true };
  }

  async logout(): Promise<{ ok: boolean }> {
    return this.revokeAllRefreshTokens();
  }

  // === Organization Management ===

  setOrganizationContext(organizationId?: string): void {
    this.database.setOrganizationContext(organizationId);
  }

  async createOrganization(name: string): Promise<{ organization: Organization }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    const organization: Organization = {
      id: crypto.randomUUID(),
      name,
      ownerId: user.id,
      createdAt: new Date().toISOString(),
    };

    // Store organization in my UserDO (I own it)
    await this.ownedOrganizations.create(organization);

    this.broadcast('organization:created', { organization });

    return { organization };
  }

  async getOrganizations(): Promise<{ organizations: Organization[]; memberOrganizations: OrganizationMembership[] }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    // Get organizations I own
    const ownedOrganizations = await this.ownedOrganizations.getAll();

    // Get organizations I'm a member of
    const memberOrganizations = await this.storage.get<OrganizationMembership[]>('organization_memberships') || [];

    return {
      organizations: ownedOrganizations,
      memberOrganizations
    };
  }

  async getOrganization(organizationId: string): Promise<{ organization: Organization; members: OrganizationMember[]; isOwner: boolean }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    // First check if I own this organization
    const ownedOrg = await this.ownedOrganizations.findById(organizationId);

    if (ownedOrg) {
      // I own it - get members from my UserDO
      const members = await this.organizationMembers.where('organizationId', '==', organizationId).get();
      return { organization: ownedOrg, members, isOwner: true };
    }

    // Check if I'm a member of this organization
    const memberships = await this.storage.get<OrganizationMembership[]>('organization_memberships') || [];
    const membership = memberships.find(m => m.organizationId === organizationId);

    if (!membership) {
      throw new Error('Not a member of this organization');
    }

    // Get organization data from the owner's UserDO
    const namespace = this.findUserDONamespace();
    // const ownerDO = getUserDO(namespace, membership.ownerEmail);
    const ownerDO = getUserDO(namespace, membership.ownerIdentifier);
    const ownerOrgData = await ownerDO.getOwnedOrganization(organizationId);

    return {
      organization: ownerOrgData.organization,
      members: ownerOrgData.members,
      isOwner: false
    };
  }

  // Helper method for cross-UserDO access
  async getOwnedOrganization(organizationId: string): Promise<{ organization: Organization; members: OrganizationMember[] }> {
    const organization = await this.ownedOrganizations.findById(organizationId);

    if (!organization) throw new Error('Organization not found');

    const members = await this.organizationMembers.where('organizationId', '==', organizationId).get();
    return { organization, members };
  }

  async addOrganizationMember(
    organizationId: string,
    identifier: string, // address hoặc email hoặc phone number
    role: 'admin' | 'member' = 'member'
  ): Promise<{ member: OrganizationMember }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    // Check if I own this organization
    const organization = await this.ownedOrganizations.findById(organizationId);
    if (!organization) {
      throw new Error('Organization not found or you do not own it');
    }

    // Get target user ID từ identifier (hash để tạo ID)
    const targetUserId = await hashIdentifierForId(identifier);

    // Check nếu member đã tồn tại
    const existingMember = await this.organizationMembers
      .where('organizationId', '==', organizationId)
      .where('identifier', '==', identifier.toLowerCase())
      .first();

    if (existingMember) {
      throw new Error('User is already a member of this organization');
    }

    const member: OrganizationMember = {
      id: crypto.randomUUID(),
      organizationId,
      userId: targetUserId,
      identifier: identifier.toLowerCase(),
      role,
      createdAt: new Date().toISOString(),
    };

    // Store member trong UserDO của owner (tôi own org)
    await this.organizationMembers.create(member);

    // Add membership cho target user's UserDO
    try {
      const namespace = this.findUserDONamespace();
      const targetUserDO = getUserDO(namespace, identifier.toLowerCase());

      await targetUserDO.addMembership({
        organizationId,
        organizationName: organization.name,
        ownerIdentifier: user.identifier, // thay ownerEmail -> ownerIdentifier
        role,
        joinedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to add membership to target user:', error);
      console.log(
        'Could not deliver membership immediately - will be available when user signs up'
      );
    }

    this.broadcast('organization:member_added', { organizationId, member });

    return { member };
  }


  // Helper method to add membership to a user's UserDO
  async addMembership(membership: OrganizationMembership): Promise<void> {
    const memberships = await this.storage.get<OrganizationMembership[]>('organization_memberships') || [];

    // Check if membership already exists
    const existingIndex = memberships.findIndex(m => m.organizationId === membership.organizationId);
    if (existingIndex >= 0) {
      // Update existing membership
      memberships[existingIndex] = membership;
    } else {
      // Add new membership
      memberships.push(membership);
    }

    await this.storage.put('organization_memberships', memberships);
  }

  async removeOrganizationMember(organizationId: string, userId: string): Promise<{ ok: boolean }> {
    const user = await this.storage.get<User>(AUTH_DATA_KEY);
    if (!user) throw new Error('User not found');

    // Check if I own this organization
    const organization = await this.ownedOrganizations.findById(organizationId);
    if (!organization) {
      throw new Error('Organization not found or you do not own it');
    }

    // Get the member to remove
    const member = await this.organizationMembers.where('organizationId', '==', organizationId).where('userId', '==', userId).first();
    if (!member) {
      throw new Error('Member not found');
    }

    // Remove member from my UserDO (I own the organization)
    await this.organizationMembers.delete(member.id);

    // Remove membership from the target user's UserDO
    try {
      const namespace = this.findUserDONamespace();
      const targetUserDO = getUserDO(namespace, member.identifier);
      await targetUserDO.removeMembership(organizationId);
    } catch (error) {
      console.error('Failed to remove membership from target user:', error);
      // Don't fail the whole operation if this fails
    }

    this.broadcast('organization:member_removed', { organizationId, userId });

    return { ok: true };
  }

  // Helper method to remove membership from a user's UserDO
  async removeMembership(organizationId: string): Promise<void> {
    const memberships = await this.storage.get<OrganizationMembership[]>('organization_memberships') || [];
    const updatedMemberships = memberships.filter(m => m.organizationId !== organizationId);
    await this.storage.put('organization_memberships', updatedMemberships);
  }

  // Helper to find the correct UserDO namespace dynamically
  private findUserDONamespace(): DurableObjectNamespace<UserDO> {
    // Try USERDO first (default)
    if (this.env.USERDO) {
      return this.env.USERDO as DurableObjectNamespace<UserDO>;
    }

    // Look for any UserDO-compatible namespace in the environment
    for (const [key, value] of Object.entries(this.env)) {
      if (value && typeof value === 'object' && 'get' in value && 'idFromName' in value) {
        return value as DurableObjectNamespace<UserDO>;
      }
    }

    throw new Error('No UserDO namespace found in environment');
  }

  public table<T extends z.ZodSchema>(
    name: string,
    schema: T,
    options?: TableOptions
  ) {
    return this.database.table(name, schema, options);
  }

  public get db() {
    return this.database.raw;
  }

  protected getCurrentUserId(): string {
    return this.state.id.toString();
  }

  // WebSocket connection handling using Hibernation API
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle WebSocket upgrades directly in the UserDO
    if (request.headers.get('upgrade') === 'websocket') {
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      // Use hibernation API - this makes the WebSocket hibernatable
      this.ctx.acceptWebSocket(server);

      console.log('🔌 WebSocket accepted by UserDO with hibernation');

      // Send welcome message
      server.send(JSON.stringify({
        event: 'connected',
        message: 'WebSocket connected to UserDO!',
        timestamp: Date.now()
      }));

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Handle other requests normally
    return new Response('Not Found', { status: 404 });
  }

  // WebSocket message handler (called by runtime when hibernated)
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const parsed = JSON.parse(data);
      console.log('📨 UserDO WebSocket message received:', parsed);

      // Echo back
      ws.send(JSON.stringify({
        event: 'echo',
        original: parsed,
        message: 'Message received by UserDO',
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  }

  // WebSocket close handler (called by runtime when hibernated)
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    console.log('🔌 UserDO WebSocket closed:', { code, reason, wasClean });
  }

  // Broadcast to all connected WebSocket clients using hibernation API
  protected broadcast(event: string, data: any): void {
    const message = JSON.stringify({ event, data, timestamp: Date.now() });

    // Use hibernation API to get all connected WebSockets
    const webSockets = this.ctx.getWebSockets();

    console.log(`📡 UserDO Broadcasting to ${webSockets.length} WebSocket clients:`, { event, data });

    for (const ws of webSockets) {
      try {
        ws.send(message);
      } catch (error) {
        console.error('Broadcast error:', error);
        // WebSocket will be automatically cleaned up by runtime
      }
    }
  }

}

export default {};
