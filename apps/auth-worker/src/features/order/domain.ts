import { z } from 'zod';

// Schemas
export const OrderItemSchema = z.object({
  orderId: z.string(),
  targetType: z.enum(['SERVICE', 'USER']),
  // Service fields (dùng cho cả SERVICE và USER)
  serviceId: z.string(),
  serviceName: z.string(),
  basePrice: z.number().min(0),
  quantity: z.number().min(1),
  currentCalls: z.number().min(0).optional(),
  maxCalls: z.number().min(0).optional(),
  // Pricing results
  finalUnitPrice: z.number().min(0).optional(),
  totalPrice: z.number().min(0).optional(),
  appliedPricingPolicyId: z.string().optional(),
});

export const OrderSchema = z.object({
  orderCode: z.string(),
  targetType: z.enum(['SERVICE', 'USER']),
  // Customer info
  customerId: z.string(),
  customerName: z.string(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  // User info (dùng cho USER targetType)
  userId: z.string().optional(),
  userRole: z.enum(['member', 'admin']).optional(),
  userGroup: z.string().optional(),
  // Pricing
  subtotalAmount: z.number().min(0),
  discountAmount: z.number().min(0).default(0),
  totalAmount: z.number().min(0),
  finalAmount: z.number().min(0),
  // Applied discounts
  appliedVoucherCode: z.string().optional(),
  appliedVoucherDiscount: z.number().min(0).default(0),
  // Status
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED']),
  // Metadata
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const OrderDiscountSchema = z.object({
  orderId: z.string(),
  discountType: z.enum(['PRICE_POLICY', 'VOUCHER', 'MANUAL']),
  discountSource: z.string(),
  discountAmount: z.number().min(0),
  description: z.string(),
  appliedAt: z.string().default(() => new Date().toISOString()),
});

// Request Schemas
export const CreateOrderSchema = z.object({
  targetType: z.enum(['SERVICE', 'USER']),
  // Customer info
  customerId: z.string(),
  customerName: z.string(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  // User info (dùng cho USER targetType)
  userId: z.string().optional(),
  userRole: z.enum(['member', 'admin']).optional(),
  userGroup: z.string().optional(),
  // Items (chỉ có service)
  items: z.array(OrderItemSchema).min(1),
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
  targetType: z.enum(['SERVICE', 'USER']),
  // Customer info (dùng cho SERVICE targetType)
  customerId: z.string().optional(),
  // User info (dùng cho USER targetType)  
  userId: z.string().optional(),
  userRole: z.enum(['member', 'admin']).optional(),
  userGroup: z.string().optional(),
  // Items (chỉ có service)
  items: z.array(OrderItemSchema).min(1),
  voucherCode: z.string().optional(),
});

// Types
export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type OrderDiscount = z.infer<typeof OrderDiscountSchema>;
export type CreateOrder = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatus = z.infer<typeof UpdateOrderStatusSchema>;
export type ApplyVoucherToOrder = z.infer<typeof ApplyVoucherToOrderSchema>;
export type CalculateOrderRequest = z.infer<typeof CalculateOrderRequestSchema>;

export interface OrderDetail extends Order {
  items: OrderItem[];
  discounts: OrderDiscount[];
}

// Domain Interfaces
export interface IOrderInfrastructureService {
  createOrder(request: CreateOrder): Promise<any>;
  getOrders(filters: any): Promise<any[]>;
  getOrderDetail(orderId: string): Promise<any>;
  updateOrderStatus(orderId: string, request: UpdateOrderStatus): Promise<any>;
  applyVoucherToOrder(orderId: string, request: ApplyVoucherToOrder): Promise<any>;
  calculateOrder(request: CalculateOrderRequest): Promise<any>;
  cancelOrder(orderId: string): Promise<any>;
  getAvailableVouchersForOrder(orderId: string): Promise<any[]>;
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