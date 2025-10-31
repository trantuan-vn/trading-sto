import { Context } from 'hono';
import { getDO } from '../../shared/utils';
import { UserDO } from './infrastructure/UserDO';
import { BroadcastServiceDO } from './infrastructure/BroadcastServiceDO';

interface IWebsocketApplicationService {
    connectWebSocketUseCase: (identifier: string) => Promise<Response>;
    broadcastMessageUseCase: (request: Request) => Promise<Response>;
}

export function createWebsocketApplicationService(c: Context, bindingName: string): IWebsocketApplicationService {
    return {
        connectWebSocketUseCase: (identifier: string) => {
            const userDO = getDO<UserDO>(c, identifier, bindingName);
            const request = c.req.raw;
            return userDO.fetch(request);
        },
        broadcastMessageUseCase: (request: Request) => {
            const broadcastService = getDO<BroadcastServiceDO>(c, "global", "BROADCAST_SERVICE_DO");
            return broadcastService.fetch(request);
        }
    }
}