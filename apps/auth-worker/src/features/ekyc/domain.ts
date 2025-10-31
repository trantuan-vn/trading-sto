import { z } from 'zod';

// Document Recognition Schemas
export const DocumentRecognitionSchema = z.object({
  image: z.instanceof(File).refine(
    (file) => ['image/jpeg', 'image/png'].includes(file.type),
    'Only JPEG and PNG images are supported'
  ),
  docType: z.enum(['driver', 'cmt', 'cccd_front', 'cccd_back', 'passport', 'general']).default('general'),
  options: z.object({
    maxTokens: z.number().min(100).max(2000).default(500),
    language: z.string().default('vi'),
    confidenceThreshold: z.number().min(0).max(1).default(0.8),
  }).optional().default({}),
});

export const DocumentExtractionResultSchema = z.object({
  documentType: z.string(),
  extractedData: z.record(z.any()),
  confidence: z.number().min(0).max(1),
  processingTime: z.number().optional(),
  metadata: z.object({
    imageSize: z.number().optional(),
    imageType: z.string().optional(),
  }).optional(),
});

// Face Detection Schemas
export const FaceSearchSchema = z.object({
  image: z.instanceof(File).refine(
    (file) => ['image/jpeg', 'image/png'].includes(file.type),
    'Only JPEG and PNG images are supported'
  ),
  options: z.object({
    maxTokens: z.number().min(50).max(1000).default(200),
    detectionThreshold: z.number().min(0).max(1).default(0.7),
    maxFaces: z.number().min(1).max(50).default(10),
  }).optional().default({}),
});

export const FaceDetectionResultSchema = z.object({
  faces: z.array(z.object({
    boundingBox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    confidence: z.number().min(0).max(1),
    landmarks: z.array(z.object({
      x: z.number(),
      y: z.number(),
      type: z.string(),
    })).optional(),
    attributes: z.object({
      age: z.number().optional(),
      gender: z.string().optional(),
      emotions: z.array(z.string()).optional(),
    }).optional(),
  })),
  confidence: z.number().min(0).max(1),
  faceCount: z.number(),
  processingTime: z.number().optional(),
});

// Face Verification Schemas
export const FaceVerificationSchema = z.object({
  image: z.instanceof(File).refine(
    (file) => ['image/jpeg', 'image/png'].includes(file.type),
    'Only JPEG and PNG images are supported'
  ),
  image2: z.instanceof(File).refine(
    (file) => ['image/jpeg', 'image/png'].includes(file.type),
    'Only JPEG and PNG images are supported'
  ).nullable(),
  options: z.object({
    maxTokens: z.number().min(100).max(1000).default(300),
    similarityThreshold: z.number().min(0).max(1).default(0.75),
    enableAttributes: z.boolean().default(true),
  }).optional().default({}),
});

export const FaceVerificationResultSchema = z.object({
  similarity: z.number().min(0).max(1),
  isMatch: z.boolean(),
  details: z.string(),
  confidence: z.number().min(0).max(1),
  attributes: z.object({
    image1: z.object({
      age: z.number().optional(),
      gender: z.string().optional(),
      quality: z.number().optional(),
    }).optional(),
    image2: z.object({
      age: z.number().optional(),
      gender: z.string().optional(),
      quality: z.number().optional(),
    }).optional(),
  }).optional(),
  processingTime: z.number().optional(),
});

// Liveness Detection Schemas
export const LivenessDetectionSchema = z.object({
  image: z.instanceof(File).refine(
    (file) => ['image/jpeg', 'image/png'].includes(file.type),
    'Only JPEG and PNG images are supported'
  ),
  isVideo: z.boolean().default(false),
  options: z.object({
    maxTokens: z.number().min(50).max(1000).default(200),
    detectionMode: z.enum(['strict', 'normal', 'relaxed']).default('normal'),
    spoofTypes: z.array(z.string()).default(['photo', 'screen', 'mask']),
  }).optional().default({}),
});

export const LivenessResultSchema = z.object({
  isLive: z.boolean(),
  details: z.string(),
  confidence: z.number().min(0).max(1),
  spoofType: z.string().optional(),
  riskScore: z.number().min(0).max(1).optional(),
  processingTime: z.number().optional(),
  recommendations: z.array(z.string()).optional(),
});

// Common Response Schema
export const AIProcessingResponseSchema = z.object({
  success: z.boolean(),
  data: z.union([
    DocumentExtractionResultSchema,
    FaceDetectionResultSchema,
    FaceVerificationResultSchema,
    LivenessResultSchema,
  ]),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }).optional(),
  metadata: z.object({
    requestId: z.string(),
    timestamp: z.string(),
    model: z.string(),
    version: z.string(),
  }),
});

// Types
export type DocumentRecognition = z.infer<typeof DocumentRecognitionSchema>;
export type DocumentExtractionResult = z.infer<typeof DocumentExtractionResultSchema>;
export type FaceSearch = z.infer<typeof FaceSearchSchema>;
export type FaceDetectionResult = z.infer<typeof FaceDetectionResultSchema>;
export type FaceVerification = z.infer<typeof FaceVerificationSchema>;
export type FaceVerificationResult = z.infer<typeof FaceVerificationResultSchema>;
export type LivenessDetection = z.infer<typeof LivenessDetectionSchema>;
export type LivenessResult = z.infer<typeof LivenessResultSchema>;
export type AIProcessingResponse = z.infer<typeof AIProcessingResponseSchema>;

// Domain Interfaces
export interface IAIDocumentService {
  // Document Recognition
  recognizeDocument(request: DocumentRecognition): Promise<DocumentExtractionResult>;
  // Face Detection
  faceSearch(request: FaceSearch): Promise<FaceDetectionResult>;
  // Face Verification
  faceVerify(request: FaceVerification): Promise<FaceVerificationResult>;
  // Liveness Detection
  livenessDetection(request: LivenessDetection): Promise<LivenessResult>;
}

export interface IImageProcessor {
  validateImage(image: File): Promise<{ isValid: boolean; error?: string }>;
  convertToBase64(image: File): Promise<string>;
  getImageMetadata(image: File): Promise<{ size: number; type: string; dimensions?: { width: number; height: number } }>;
}

export interface IAIModelProvider {
  runModel(
    model: string, 
    messages: any[], 
    options: { max_tokens: number }
  ): Promise<{ response: string }>;
  
  getAvailableModels(): string[];
  validateModelCapabilities(model: string, task: string): boolean;
}

export interface IResultValidator {
  validateDocumentExtraction(result: any): DocumentExtractionResult;
  validateFaceDetection(result: any): FaceDetectionResult;
  validateFaceVerification(result: any): FaceVerificationResult;
  validateLivenessDetection(result: any): LivenessResult;
}