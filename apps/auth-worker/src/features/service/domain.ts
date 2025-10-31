import { z } from 'zod';

// Schemas
export const ServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  endpoints: z.array(z.string()),
  maxCalls: z.number().min(0).default(0),
  currentCalls: z.number().min(0).default(0),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isActive: z.boolean().default(true),
});

export const RegisterServiceSchema = z.object({
  name: z.string().min(1).max(100),
  endpoints: z.array(z.string()).min(1),
  maxCalls: z.number().min(0).optional().default(1000), // Mặc định 1000 calls
  expiresInDays: z.number().min(1).max(365).optional().default(30),
});

export const VNPayPaymentSchema = z.object({
  serviceId: z.string().uuid(),
  amount: z.number().min(10000), // Tối thiểu 10,000 VND
  orderInfo: z.string().optional(),
  ipAddress: z.string().optional(),
});

export const ServiceUsageSchema = z.object({
  serviceId: z.string().uuid(),
  endpoint: z.string(),
  timestamp: z.string(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
});

// Types
export type Service = z.infer<typeof ServiceSchema>;
export type RegisterService = z.infer<typeof RegisterServiceSchema>;
export type VNPayPayment = z.infer<typeof VNPayPaymentSchema>;
export type ServiceUsage = z.infer<typeof ServiceUsageSchema>;

// Domain Interfaces
export interface IServiceApplicationService {
  registerService(identifier: string, request: RegisterService): Promise<Service>;
  getUserServices(identifier: string): Promise<Service[]>;
  cancelService(identifier: string, serviceId: string): Promise<void>;
  processVNPayPayment(identifier: string, request: VNPayPayment): Promise<{ success: boolean; transactionId: string }>;
  recordEndpointUsage(identifier: string, usage: ServiceUsage): Promise<void>;
  getServiceUsage(identifier: string, serviceId: string, days?: number): Promise<ServiceUsage[]>;
}

export interface IServiceInfrastructureService {
  registerService(request: RegisterService): Promise<Service>;
  getUserServices(): Promise<Service[]>;
  cancelService(serviceId: string): Promise<void>;
  processVNPayPayment(request: VNPayPayment): Promise<{ success: boolean; transactionId: string }>;
  recordEndpointUsage(usage: ServiceUsage): Promise<void>;
  getServiceUsage(serviceId: string, days?: number): Promise<ServiceUsage[]>;
}