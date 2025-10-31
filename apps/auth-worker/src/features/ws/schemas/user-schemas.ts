import { z } from 'zod';

// User Domain Object Schemas
export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  connected: z.boolean(),
  lastConnected: z.number(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const PendingMessageSchema = z.object({
  id: z.string().uuid(),
  message: z.any(),
  type: z.string(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  attempts: z.number().min(0).default(0),
  maxAttempts: z.number().min(1).default(3),
  lastAttempt: z.number().optional(),
  createdAt: z.number(),
  scheduledFor: z.number().optional()
});

export const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  channel: z.string(),
  subscribedAt: z.number(),
  filters: z.record(z.any()).optional(),
  isActive: z.boolean().default(true)
});

export const AlarmSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['heartbeat', 'broadcast', 'retry', 'custom']),
  scheduledTime: z.number(),
  data: z.any().optional(),
  status: z.enum(['pending', 'executing', 'completed', 'failed']).default('pending'),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const UserPreferenceSchema = z.object({
  key: z.string(),
  value: z.any(),
  category: z.string().default('general'),
  updatedAt: z.number()
});

// Export types
export type Connection = z.infer<typeof ConnectionSchema>;
export type PendingMessage = z.infer<typeof PendingMessageSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Alarm = z.infer<typeof AlarmSchema>;
export type UserPreference = z.infer<typeof UserPreferenceSchema>;