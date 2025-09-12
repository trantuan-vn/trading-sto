import { SendMessageUseCase } from "./application/usecases/SendMessageUseCase";
import { ConsumeMessageUseCase } from "./application/usecases/ConsumeMessageUseCase";
import  { type RequestMessage, createRequestMessage } from "./domain/models/RequestMessage";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const sendMessageUseCase = new SendMessageUseCase(env);
		const requestMessage = await createRequestMessage(request);
		await sendMessageUseCase.execute(requestMessage);
		return new Response('Sent message to the queue', { status: 200 });
	},
	async queue(batch, env, ctx): Promise<void> {
		const consumeMessageUseCase = new ConsumeMessageUseCase();
		await consumeMessageUseCase.execute(batch);
	},
} satisfies ExportedHandler<Env, Error>;
