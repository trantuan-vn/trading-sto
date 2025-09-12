export interface RequestMessage {
  url: string;
  method: string;
  headers: Record<string, string>;
}

// Hàm tiện ích để tạo RequestMessage
export async function createRequestMessage(req: Request): Promise<RequestMessage> {
  return {
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers),
  };
}

