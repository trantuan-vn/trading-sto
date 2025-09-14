import { ConsumeMessageUseCase } from "./application/usecases/ConsumeMessageUseCase";

export default {
	async queue(batch, env, ctx): Promise<void> {
		const consumeMessageUseCase = new ConsumeMessageUseCase();
		await consumeMessageUseCase.execute(batch, env);
	},
} satisfies ExportedHandler<Env, Error>;
