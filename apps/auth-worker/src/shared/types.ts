import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const SuccessResponseSchema = z.object({
  ok: z.literal(true),
});

export const EventsResponseSchema = z.array(z.object({
  event: z.string(),
  data: z.unknown(),
  timestamp: z.number(),
}));

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;