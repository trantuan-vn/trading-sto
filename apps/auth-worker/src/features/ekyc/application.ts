import { Context } from 'hono';
import { getIdFromName } from '../../shared/utils';
import { UserDO } from '../ws/infrastructure/UserDO';
import { createAIService } from './infrastructure';
import { 
  DocumentRecognitionSchema,
  FaceSearchSchema,
  FaceVerificationSchema,
  LivenessDetectionSchema,
  DocumentExtractionResultSchema,
  FaceDetectionResultSchema,
  FaceVerificationResultSchema,
  LivenessResultSchema,
  DocumentExtractionResult,
  FaceDetectionResult,
  FaceVerificationResult,
  LivenessResult
} from './domain';

interface IAIDocumentApplicationService {
  // Document Recognition
  recognizeDocumentUseCase(identifier: string, request: any): Promise<DocumentExtractionResult>;
  
  // Face Detection
  faceSearchUseCase(identifier: string, request: any): Promise<FaceDetectionResult>;
  
  // Face Verification
  faceVerifyUseCase(identifier: string, request: any): Promise<FaceVerificationResult>;
  
  // Liveness Detection
  livenessDetectionUseCase(identifier: string, request: any): Promise<LivenessResult>;
}

export function createDocumentAIService(c: Context, bindingName: string): IAIDocumentApplicationService {
  return {
    async recognizeDocumentUseCase(identifier: string, request: any): Promise<DocumentExtractionResult> {
      // Validate request with Zod schema
      const validatedRequest = DocumentRecognitionSchema.parse(request);
      
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const aiService = createAIService(userDO);
      
      const result = await aiService.recognizeDocument(validatedRequest);
      
      // Validate result with Zod schema
      return DocumentExtractionResultSchema.parse(result);
    },

    async faceSearchUseCase(identifier: string, request: any): Promise<FaceDetectionResult> {
      // Validate request with Zod schema
      const validatedRequest = FaceSearchSchema.parse(request);
      
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const aiService = createAIService(userDO);
      
      const result = await aiService.faceSearch(validatedRequest);
      
      // Validate result with Zod schema
      return FaceDetectionResultSchema.parse(result);
    },

    async faceVerifyUseCase(identifier: string, request: any): Promise<FaceVerificationResult> {
      // Validate request with Zod schema
      const validatedRequest = FaceVerificationSchema.parse(request);
      
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const aiService = createAIService(userDO);
      
      const result = await aiService.faceVerify(validatedRequest);
      
      // Validate result with Zod schema
      return FaceVerificationResultSchema.parse(result);
    },

    async livenessDetectionUseCase(identifier: string, request: any): Promise<LivenessResult> {
      // Validate request with Zod schema
      const validatedRequest = LivenessDetectionSchema.parse(request);
      
      const userDO = getIdFromName<UserDO>(c, identifier, bindingName);
      const aiService = createAIService(userDO);
      
      const result = await aiService.livenessDetection(validatedRequest);
      
      // Validate result with Zod schema
      return LivenessResultSchema.parse(result);
    }
  };
}