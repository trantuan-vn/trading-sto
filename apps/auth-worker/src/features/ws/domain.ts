import { z } from 'zod';

export * from './schemas'

// Schema for WebSocket message validation
export const WebSocketMessageSchema = z.object({
  type: z.enum(['ping', 'subscribe', 'unsubscribe']),
  channel: z.string().optional(),
  data: z.any().optional()
});