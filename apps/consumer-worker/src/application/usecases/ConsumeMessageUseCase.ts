import { MessageProcessor } from "../../domain/services/MessageProcessor";
export class ConsumeMessageUseCase {
  private processor = new MessageProcessor();

  async execute(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        this.processor.process(msg.body, env);
        msg.ack();
      } catch (err) {
        console.error("Failed:", err);
        msg.retry();
      }
    }
  }
}
