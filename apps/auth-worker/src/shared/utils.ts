import { Context } from 'hono'
import CryptoJS from 'crypto-js';

export const handleError = async (c: Context, e: any, defaultMessage: string) => {
  try {
    // Tách các thông tin thường gặp trong Error object
    const message = e?.message || String(e);
    const stack = e?.stack;
    const name = e?.name;
    const cause = e?.cause;

    // Nếu là lỗi từ Axios hoặc Fetch, có thể có response
    const responseData = e?.response?.data;
    const responseStatus = e?.response?.status;
    const responseText = e?.response?.statusText;

    // Gom toàn bộ thông tin chi tiết
    const details = {
      name,
      message,
      stack,
      cause,
      response: responseData
        ? { status: responseStatus, statusText: responseText, data: responseData }
        : undefined,
      raw: typeof e === "object" ? e : String(e),
    };  
    
    const errorLog = {
      error: `${defaultMessage}: ${message}`,
      details,
    };
    console.error("❌ [ErrorHandler]", JSON.stringify(errorLog, null, 2));

    const errorResponse = { error: `${defaultMessage}`};

    const ip= getClientIp(c);
    const ipData = await c.env.NONCE_KV.get(ip);
    let failCount = 1;
    let blockDuration = 5 * 60 * 1000; // 5 phút
    
    if (ipData) {
      const data = JSON.parse(ipData);
      failCount = data.failCount + 1;
      
      // Tăng thời gian chặn theo số lần
      if (failCount >= 6) blockDuration = 15 * 60 * 1000; // 15 phút
      if (failCount >= 10) blockDuration = 60 * 60 * 1000; // 1 giờ
      if (failCount >= 15) blockDuration = 24 * 60 * 60 * 1000; // 24 giờ
      
    }
    
    const blockData = {
      failCount: failCount,
      blockUntil: Date.now() + blockDuration,
      lastAttempt: Date.now()
    };
    
    await c.env.NONCE_KV.put(ip, JSON.stringify(blockData), {
      expirationTtl: 24 * 60 * 60 // TTL 24 giờ
    });  
    
    return { errorResponse, status: 400 as const };
  } catch (error) {
    console.error("❌ [ErrorHandler]", error);
    return { errorResponse: { error: `${defaultMessage}`}, status: 400 as const };
  }
};

export const handleErrorWithoutIp = async (e: any, defaultMessage: string) => {
  try {
    // Tách các thông tin thường gặp trong Error object
    const message = e?.message || String(e);
    const stack = e?.stack;
    const name = e?.name;
    const cause = e?.cause;

    // Nếu là lỗi từ Axios hoặc Fetch, có thể có response
    const responseData = e?.response?.data;
    const responseStatus = e?.response?.status;
    const responseText = e?.response?.statusText;

    // Gom toàn bộ thông tin chi tiết
    const details = {
      name,
      message,
      stack,
      cause,
      response: responseData
        ? { status: responseStatus, statusText: responseText, data: responseData }
        : undefined,
      raw: typeof e === "object" ? e : String(e),
    };  
    
    const errorLog = {
      error: `${defaultMessage}: ${message}`,
      details,
    };
    console.error("❌ [ErrorHandler]", JSON.stringify(errorLog, null, 2));

    const errorResponse = { error: `${defaultMessage}`};
    
    return { errorResponse, status: 400 as const };
  } catch (error) {
    console.error("❌ [ErrorHandler]", error);
    return { errorResponse: { error: `${defaultMessage}`}, status: 400 as const };
  }
};

export const parseBody = async (c: Context, schema: any) => {
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    return schema.parse(await c.req.json());
  } else {
    const formData = await c.req.formData();
    const entries: { [key: string]: any } = {};
    formData.forEach((value, key) => {
      entries[key] = value;
    });
    return schema.parse(entries);
  }
};

export function getIdFromName(c: Context, identifier: string, bindingName: string): DurableObjectStub {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromName(identifier);
  return binding.get(doID); // as unknown as T;
}

export function getIdFromString(c: Context, id: string, bindingName: string): DurableObjectStub {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromString(id);
  return binding.get(doID); // as unknown as T;
}

export function isAdmin(identifier: string) {
  return identifier === 'tuanta2021@gmail.com';
}

export function getIPAndUserAgent(request: Request) {
  const ipAddress = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || request.headers.get('X-Forwarded-For');
  const userAgent = request.headers.get('User-Agent') || 'apiToken';
  return { ipAddress, userAgent };
}

export const getSessionIdHash = (ipAddress: string, userAgent: string, secret: string) => {
  const data = `${ipAddress}|${userAgent}|${secret}`;
  return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
}

export const getClientIp = (c: any): string => {
  return c.req.raw.headers.get('CF-Connecting-IP') || c.req.raw.headers.get('X-Real-IP') || c.req.raw.headers.get('X-Forwarded-For');
};

// utils/featureLoader.ts
type FeatureMethods = { [key: string]: Function };

export class FeatureLoader {
  private features: Map<string, FeatureMethods> = new Map();

  // Đăng ký feature mới
  registerFeature(featureName: string, methods: FeatureMethods): void {
    console.log(`📦 FeatureLoader: Đăng ký feature '${featureName}' với ${Object.keys(methods).length} methods`);
    this.features.set(featureName, methods);
  }

  // Áp dụng tất cả features vào class
  applyToClass(targetClass: any, context: any): void {
    console.log('🔧 FeatureLoader: Áp dụng features vào class...');
    
    this.features.forEach((methods, featureName) => {
      Object.entries(methods).forEach(([methodName, method]) => {
        if (typeof method === 'function') {
          // Bind method với context và đăng ký vào class
          targetClass.prototype[methodName] = method.bind(context);
          console.log(`   ✅ Thêm method: ${methodName} từ feature ${featureName}`);
        }
      });
    });
  }

  // Lấy tất cả methods (cho TypeScript types)
  getAllMethods(): string[] {
    const methods: string[] = [];
    this.features.forEach(featureMethods => {
      methods.push(...Object.keys(featureMethods));
    });
    return methods;
  }
}

// Global feature loader instance
export const featureLoader = new FeatureLoader();