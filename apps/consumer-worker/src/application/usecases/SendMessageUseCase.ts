import type { RequestMessage } from "../../domain/models/RequestMessage";

export class SendMessageUseCase {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }
  async execute(message: RequestMessage): Promise<void> {
    await this.env.input_part_0.send(message);
  }
}
