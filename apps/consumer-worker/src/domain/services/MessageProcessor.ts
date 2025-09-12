import type { RequestMessage } from "../models/RequestMessage";

export class MessageProcessor {
  process(message: RequestMessage): void {
    // throw new Error("Simulate failure for DLQ");  // Gây lỗi
		// Logic business thuần (ở đây chỉ log)
    //console.log("Processing:", JSON.stringify(message));
  }
}
