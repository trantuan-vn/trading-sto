import { Context } from 'hono'

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
  const contentType = c.req.header('content-type') || '';
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

export function getIdFromName<T>(c: Context, identifier: string, bindingName: string): T {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromName(identifier);
  return binding.get(doID) as unknown as T;
}

export function getIdFromString<T>(c: Context, id: string, bindingName: string): T {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromName(id);
  return binding.get(doID) as unknown as T;
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
  return c.req.headers.get('CF-Connecting-IP') || c.req.headers.get('X-Real-IP') || c.req.headers.get('X-Forwarded-For');
};

