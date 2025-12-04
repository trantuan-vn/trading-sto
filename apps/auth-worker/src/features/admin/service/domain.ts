import { z } from 'zod';

// Schemas
export const ServiceSchema = z.object({
  name: z.string().min(1).max(100),
  endpoint: z.string(),
  maxCalls: z.number().min(0).default(0),
  currentCalls: z.number().min(0).default(0),
  expiresAt: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const ServiceUsageSchema = z.object({
  serviceId: z.string(),
  endpoint: z.string(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
});

export const ServiceIdSchema = z.string().uuid();

// Types
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceUsage = z.infer<typeof ServiceUsageSchema>;

// Domain Interfaces
export interface IServiceInfrastructureService {
  registerService(request: Service): Promise<any>;
  getUserServices(): Promise<any[]>;
  cancelService(serviceId: string): Promise<void>;
  getServiceUsage(serviceId: string, days?: number): Promise<any[]>;
}