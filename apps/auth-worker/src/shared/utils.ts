import { ErrorResponse } from './types';
import { Context } from 'hono'

export const handleError = (e: any, defaultMessage: string) => {
  const errorResponse: ErrorResponse = { error: e.message || defaultMessage };
  console.error(e);
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
