import { Hono } from 'hono';
import { createDocumentAIService } from './application';
import { handleError, getIPAndUserAgent } from '../../shared/utils';
import { processFormData } from './utils';
import { requirePermissions } from '../token/authMiddleware';
import { EKYC_SERVICES } from './constant';

export function createEkycRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();
  // Document recognition endpoint
  app.post('/recognize-document', async (c) => {
    try {
      // Lấy full URL
      const fullUrl = new URL(c.req.url);
      const endpoint = fullUrl.pathname; 
      if (endpoint !== EKYC_SERVICES.DOCUMENT.RECOGNIZE) {
        throw new Error('Invalid endpoint');
      }
      const { ipAddress, userAgent } = getIPAndUserAgent(c.req.raw);
      if (!ipAddress || !userAgent) {
        throw new Error('Missing IP address or user agent');
      }

      const token = requirePermissions(c, [EKYC_SERVICES.DOCUMENT.RECOGNIZE]);

      const { image, docType } = await processFormData(c);
      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.recognizeDocumentUseCase(token.identifier, { image, docType, endpoint, ipAddress, userAgent });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Document recognition failed');
      return c.json(errorResponse, status);
    }
  });

  // Face search endpoint
  app.post('/face-search', async (c) => {
    try {
      // Lấy full URL
      const fullUrl = new URL(c.req.url);
      const endpoint = fullUrl.pathname; 
      if (endpoint !== EKYC_SERVICES.FACE.SEARCH) {
        throw new Error('Invalid endpoint');
      }

      const token = requirePermissions(c, [EKYC_SERVICES.FACE.SEARCH]);
      const { image } = await processFormData(c);
      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.faceSearchUseCase(token.identifier, { image, endpoint });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Face search failed');
      return c.json(errorResponse, status);
    }
  });

  // Face verification endpoint
  app.post('/face-verify', async (c) => {
    try {
      // Lấy full URL
      const fullUrl = new URL(c.req.url);
      const endpoint = fullUrl.pathname; 
      if (endpoint !== EKYC_SERVICES.FACE.VERIFY) {
        throw new Error('Invalid endpoint');
      }

      const token = requirePermissions(c, [EKYC_SERVICES.FACE.VERIFY]);  
      const { image, image2 } = await processFormData(c);
      
      if (!image2) {
        throw new Error('Missing second image for verification');
      }

      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.faceVerifyUseCase(token.identifier, { image, image2, endpoint });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Face verification failed');
      return c.json(errorResponse, status);
    }
  });

  // Liveness detection endpoint
  app.post('/face-liveness', async (c) => {
    try {
      // Lấy full URL
      const fullUrl = new URL(c.req.url);
      const endpoint = fullUrl.pathname; 
      if (endpoint !== EKYC_SERVICES.FACE.LIVENESS) {
        throw new Error('Invalid endpoint');
      }

      const token = requirePermissions(c, [EKYC_SERVICES.FACE.LIVENESS]);
      const { image, isVideo } = await processFormData(c);
      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.livenessDetectionUseCase(token.identifier, { image, isVideo, endpoint });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Liveness detection failed');
      return c.json(errorResponse, status);
    }
  });

  return app;
}