import { Hono } from 'hono';
import { createVersionApplicationService } from './application';
import { requireAuth } from '../../auth/authMiddleware';
import { handleError } from '../../../shared/utils';
import { VersionIdSchema } from './domain';

export function createVersionRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();

  // Helper function để xử lý route chung
  const createRouteHandler = (
    handler: Function, 
    errorMessage: string, 
    requireAdmin: boolean = false
  ) => {
    return async (c: any) => {
      try {
        const user = requireAuth(c);
        if (requireAdmin && user.role !== 'admin') {
          throw new Error('Insufficient permissions');
        }
        return await handler(c, user);
      } catch (e) {
        const { errorResponse, status } = await handleError(c, e, errorMessage);
        return c.json(errorResponse, status);
      }
    };
  };

  // Lưu version mới - chỉ admin
  app.post('/save', createRouteHandler(async (c: any, user: any) => {
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.saveNewVersion(user.identifier);
    return c.json(result);
  }, 'Failed to save new version', true));

  // Lấy thông tin version hiện tại
  app.get('/current', createRouteHandler(async (c: any, user: any) => {
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.getCurrentVersion(user.identifier);
    return c.json(result);
  }, 'Failed to get current version'));

  // Lấy dữ liệu version cụ thể
  app.get('/:versionId', createRouteHandler(async (c: any, user: any) => {
    const versionId = VersionIdSchema.parse(c.req.param('versionId'));
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.getVersionData(user.identifier, versionId);
    return c.json(result);
  }, 'Failed to get version data'));

  // Lấy danh sách các version - chỉ admin
  app.get('/', createRouteHandler(async (c: any, user: any) => {
    const versionApp = createVersionApplicationService(c, bindingName);
    const result = await versionApp.getVersionList(user.identifier);
    return c.json(result);
  }, 'Failed to get version list', true));

  return app;
}