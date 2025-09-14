import type { RequestMessage } from "../models/RequestMessage";

export class MessageProcessor {
  async process(requestMessage: RequestMessage, env: Env): Promise<void> {
    // throw new Error("Simulate failure for DLQ");  // Gây lỗi
		// Logic business thuần (ở đây chỉ log)
    console.log("Processing:", requestMessage);
		const { sessionId, clientId, message } = requestMessage;
		// Gửi kết quả đến SessionDurableObject
		const id = env.SESSION_DO.idFromName(sessionId);
		const stub = env.SESSION_DO.get(id);
		stub.fetch('https://fake-url/result', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientId, message: message }),
		});
  }
}
