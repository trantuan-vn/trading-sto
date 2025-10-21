import { Context } from 'hono';
import { getDO } from '../../shared/utils';
import { UserDO } from '../../shared/infrastructure/UserDO';
import { BroadcastServiceDO } from '../../shared/infrastructure/BroadcastServiceDO';

interface IWebsocketApplicationService {
    connectWebSocketUseCase: (identifier: string) => Promise<Response>;
    broadcastMessageUseCase: (data: string) => Promise<Response>;
}

export function createWebsocketApplicationService(c: Context, bindingName: string): IWebsocketApplicationService {
    return {
        connectWebSocketUseCase: (identifier: string) => {
            const userDO = getDO<UserDO>(c, identifier, bindingName);
            const request = c.req.raw;
            return userDO.fetch(request);
        },
        broadcastMessageUseCase: (data: string) => {
            const broadcastService = getDO<BroadcastServiceDO>(c, "global", "BROADCAST_SERVICE_DO");
            return broadcastService.broadcast(data);
        }
    }
}