import { ErrorResponse } from './types';
import { Context } from 'hono'

export const handleError = (e: any, defaultMessage: string) => {
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

  const errorResponse: ErrorResponse = { error: `${defaultMessage}`};
  return { errorResponse, status: 400 as const };
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

export function getDO<T>(c: Context, identifier: string, bindingName: string): T {
  const binding = c.env[bindingName];
  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found. Make sure it's configured in wrangler.jsonc`);
  }
  const doID = binding.idFromName(identifier);
  return binding.get(doID) as unknown as T;
}

export function isAdmin(identifier: string) {
  return identifier === 'tuanta2021@gmail.com';
}

export function getIPAndUserAgent(c: Context) {
  const request = c.req.raw;
  const ipAddress = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || request.headers.get('X-Forwarded-For');
  const userAgent = request.headers.get('User-Agent');
  return { ipAddress, userAgent };
}
