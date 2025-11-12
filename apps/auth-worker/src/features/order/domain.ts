import { z } from 'zod';

// Schemas
export const OrderSchema = z.object({
  orderCode: z.string(),
  // Pricing
  subtotalAmount: z.number().min(0), // total(item.basePrice*item.quantity)
  discountAmount: z.number().min(0).default(0), // total(item.discountAmount*item.quantity)
  finalAmount: z.number().min(0), // total(item.finalAmount*item.quantity)
  // Status
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED']),
  // Metadata
  currency: z.string().default('VND'),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const OrderItemSchema = z.object({
  orderId: z.string(),
  serviceId: z.string(),
  basePrice: z.number().min(0),
  discountAmount: z.number().min(0).default(0), // total(orderItemDiscount.discountAmount)
  finalAmount: z.number().min(0),
  quantity: z.number().min(1),
});


export const OrderItemDiscountSchema = z.object({
  orderItemId: z.string(),
  discountType: z.enum(['PRICE_POLICY', 'VOUCHER']),
  discountSource: z.string(),
  discountAmount: z.number().min(0), // total(appliedPolicies.discount)
  appliedPolicies: z.array(z.object({
    policyId: z.string(),
    policyName: z.string(),
    discount: z.number(),
    type: z.string(),
  })).optional(),  
  appliedVoucherCode: z.string().optional(),
  description: z.string(),
});

// Request Schemas
export const CreateOrderItemSchema = z.object({
  serviceId: z.string(),
  basePrice: z.number().min(0),
  quantity: z.number().min(1),
});

export const CreateOrderSchema = z.object({
  // Items (chỉ có service)
  items: z.array(CreateOrderItemSchema).min(1),
  currency: z.string().default('VND'),
  voucherCode: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED']),
  notes: z.string().optional(),
});

export const ApplyVoucherToOrderSchema = z.object({
  voucherCode: z.string().min(3),
});

// Chỉ cần MỘT schema cho tính toán order
export const CalculateOrderRequestSchema = z.object({
  // User info (dùng cho USER targetType)  
  userId: z.string().optional(),
  userRole: z.enum(['member', 'admin']).optional(),
  // Items (chỉ có service)
  items: z.array(CreateOrderItemSchema).min(1),
  voucherCode: z.string().optional(),
  currency: z.string().default('VND'),
});

// Types
export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type OrderItemDiscount = z.infer<typeof OrderItemDiscountSchema>;
export type CreateOrder = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatus = z.infer<typeof UpdateOrderStatusSchema>;
export type ApplyVoucherToOrder = z.infer<typeof ApplyVoucherToOrderSchema>;
export type CalculateOrderRequest = z.infer<typeof CalculateOrderRequestSchema>;

export interface OrderDetail extends Order {
  items: OrderItem[];
  discounts: OrderItemDiscount[];
}

// Domain Interfaces
export interface IOrderInfrastructureService {
  createOrder(userId: string, userRole: string, request: CreateOrder): Promise<any>;
  getOrders(filters: any): Promise<any[]>;
  getOrderDetail(orderId: string): Promise<any>;
  updateOrderStatus(orderId: string, request: UpdateOrderStatus): Promise<any>;
  cancelOrder(orderId: string): Promise<any>;
}

// VÍ DỤ SỬ DỤNG:

// 1. Tạo order cho Service (customer mua service)
// POST /api/v1/orders/orders
// {
//   "targetType": "SERVICE",
//   "customerId": "comp_techcorp",
//   "customerName": "Công ty TechCorp",
//   "userId": "user_admin01",
//   "items": [
//     {
//       "serviceId": "api_premium",
//       "serviceName": "API Premium Plan", 
//       "basePrice": 5000000,
//       "quantity": 1,
//       "currentCalls": 1500,
//       "maxCalls": 10000
//     }
//   ],
//   "voucherCode": "APISALE20",
//   "notes": "Nâng cấp gói API"
// }

// 2. Tạo order cho User (user cá nhân mua service)
// {
//   "targetType": "USER", 
//   "userId": "user_john_doe",
//   "userRole": "member",
//   "customerId": "comp_abc", // optional: user có thể thuộc customer
//   "customerName": "Công ty ABC",
//   "items": [
//     {
//       "serviceId": "basic_plan",
//       "serviceName": "Basic Plan",
//       "basePrice": 300000,
//       "quantity": 1,
//       "currentCalls": 100,
//       "maxCalls": 1000
//     }
//   ],
//   "voucherCode": "WELCOME10",
//   "notes": "Đăng ký gói basic"
// }

// 3. Tính toán giá order
// POST /api/v1/orders/calculate
// {
//   "targetType": "SERVICE",
//   "customerId": "comp_techcorp",
//   "userId": "user_admin01",
//   "items": [
//     {
//       "serviceId": "api_premium",
//       "serviceName": "API Premium Plan",
//       "basePrice": 5000000,
//       "quantity": 1,
//       "currentCalls": 1500,
//       "maxCalls": 10000
//     }
//   ],
//   "voucherCode": "APISALE20"
// }