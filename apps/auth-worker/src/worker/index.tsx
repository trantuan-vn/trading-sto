import { createUserDOWorker, createWebSocketHandler, getUserDOFromContext, UserDO, broadcastToUser } from '../server.js';
import { Context } from 'hono'
// Extend UserDO with our business logic
export class GatewayDO extends UserDO {
    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
    }
}
// Export TaskAppDO as UserDO for Durable Object binding (required by Cloudflare)
export { GatewayDO as UserDO };
// Create the worker with our custom binding name
const gatewayWorker = createUserDOWorker('GATEWAY_DO');
// Create WebSocket handler for real-time features
const webSocketHandler = createWebSocketHandler('GATEWAY_DO');
// Export the worker
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.headers.get('upgrade') === 'websocket') {
            return webSocketHandler.fetch(request, env, ctx);
        }
        return gatewayWorker.fetch(request, env, ctx);
    }
};
