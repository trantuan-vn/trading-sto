import { Hono } from 'hono';
import { createDocumentAIService } from './application';
import { handleError } from '../../shared/utils';
import { processFormData } from './utils';
import { requirePermissions } from '../token/authMiddleware';

export function createEkycRoutes(bindingName: string) {
  const app = new Hono<{ Bindings: Env }>();
  // Document recognition endpoint
  app.post('/recognize-document', async (c) => {
    try {
      const token = requirePermissions(c, ['ekyc:document:recognize']);
      const { image, docType } = await processFormData(c);
      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.recognizeDocumentUseCase(token.identifier, { image, docType });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Document recognition failed');
      return c.json(errorResponse, status);
    }
  });

  // Face search endpoint
  app.post('/face-search', async (c) => {
    try {
      const token = requirePermissions(c, ['ekyc:face:search']);
      const { image } = await processFormData(c);
      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.faceSearchUseCase(token.identifier, image);
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Face search failed');
      return c.json(errorResponse, status);
    }
  });

  // Face verification endpoint
  app.post('/face-verify', async (c) => {
    try {
      const token = requirePermissions(c, ['ekyc:face:verify']);  
      const { image, image2 } = await processFormData(c);
      
      if (!image2) {
        throw new Error('Missing second image for verification');
      }

      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.faceVerifyUseCase(token.identifier, { image, image2 });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Face verification failed');
      return c.json(errorResponse, status);
    }
  });

  // Liveness detection endpoint
  app.post('/liveness', async (c) => {
    try {
      const token = requirePermissions(c, ['ekyc:face:liveness']);
      const { image, isVideo } = await processFormData(c);
      const aiService = createDocumentAIService(c, bindingName);
      const result = await aiService.livenessDetectionUseCase(token.identifier, { image, isVideo });
      
      return c.json(result);
    } catch (e) {
      const { errorResponse, status } = handleError(e, 'Liveness detection failed');
      return c.json(errorResponse, status);
    }
  });

  return app;
}