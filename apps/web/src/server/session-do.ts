// eslint-disable-next-line import/no-unresolved
import { DurableObject } from "cloudflare:workers";
// src/session-do.ts

export class SessionDurableObject extends DurableObject {
	sessions: Map<WebSocket, { id: string }>; // Lưu WebSocket và clientId

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();

    // Khôi phục các WebSocket đang hibernate
    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment();
      if (attachment?.id) {
        this.sessions.set(ws, { id: attachment.id });
      }
    });

    // Thiết lập auto-response cho ping/pong
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  async fetch(request: Request): Promise<Response> {
    // Kiểm tra WebSocket Upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
			if (request.method !== 'GET') {
				return new Response('Expected GET method', { status: 400 });
			}

			// Tạo WebSocket pair
			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);

			// Lấy hoặc tạo clientId
			const clientId = new URL(request.url).searchParams.get('clientId') ?? crypto.randomUUID();

			// Chấp nhận WebSocket với hibernation
			this.ctx.acceptWebSocket(server);
			server.serializeAttachment({ id: clientId });
			this.sessions.set(server, { id: clientId });

			return new Response(null, { status: 101, webSocket: client });
		}
		else {
      // Handle non-WebSocket requests (e.g., HTTP POST)
      try {
        const { clientId, message } = await request.json<{
          clientId: string;
          message: any;
        }>();

        // Find the WebSocket for the given clientId
        const targetSession = Array.from(this.sessions.entries()).find(
          ([_, session]) => session.id === clientId
        );

        if (targetSession && targetSession[0].readyState === WebSocket.OPEN) {
          targetSession[0].send(
            JSON.stringify({ type: "result", data: message })
          );
          return new Response("OK", { status: 200 });
        } else {
          return new Response("No active session found for clientId", {
            status: 404,
          });
        }
      } catch (error) {
        console.error("Error in fetch:", error);
        return new Response("Invalid JSON or processing error", { status: 400 });
      }
		}
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return; // Bỏ qua nếu session không tồn tại

    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      const sessionId = this.ctx.id.toString();

      // Enqueue message vào input-part-0
      await (this.env as Env).input_part_0.send({
        sessionId,
        clientId: session.id,
        message: data,
      });

      // Gửi ack về client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ack', message: 'Received and queued' }));
      }
    } catch (error) {
      console.error('Error in webSocketMessage:', error);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.sessions.delete(ws);
    ws.close(code, 'Durable Object is closing WebSocket');
  }
}
