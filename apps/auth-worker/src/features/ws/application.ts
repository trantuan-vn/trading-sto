import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from './infrastructure/UserDO';
import { BroadcastServiceDO } from './infrastructure/BroadcastServiceDO';

interface IWebsocketApplicationService {
    connectWebSocketUseCase: (identifier: string) => Promise<Response>;
    broadcastMessageUseCase: (request: Request) => Promise<Response>;
}

export function createWebsocketApplicationService(c: Context, bindingName: string): IWebsocketApplicationService {
    return {
        connectWebSocketUseCase: (identifier: string) => {
            const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
            const request = c.req.raw;
            return userDO.fetch(request);
        },
        broadcastMessageUseCase: (request: Request) => {
            const broadcastService = getIdFromName<BroadcastServiceDO>(c, "global", "BROADCAST_SERVICE_DO");
            return broadcastService.fetch(request);
        }
    }
}