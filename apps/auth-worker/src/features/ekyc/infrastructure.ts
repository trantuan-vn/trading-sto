// infrastructure/aiService.ts
import { 
  DocumentRecognition, 
  FaceSearch, 
  FaceVerification, 
  LivenessDetection,
  DocumentExtractionResult,
  FaceDetectionResult,
  FaceVerificationResult,
  LivenessResult,
  IAIDocumentService
} from './domain';

import { toBase64, safeJsonParse, calculateConfidence, getDocumentPrompt, calculateFaceDetectionConfidence, calculateFaceVerificationConfidence } from './utils';

export function createAIService(storage: DurableObjectStorage, env: Env): IAIDocumentService {
  return {
    async recognizeDocument(request: DocumentRecognition): Promise<DocumentExtractionResult> {
      const imgB64 = await toBase64(request.image);
      const prompt = getDocumentPrompt(request.docType);

      const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [{ 
          role: 'user', 
          content: [
            { type: 'text', text: prompt }, 
            { type: 'image', image: imgB64 }
          ] 
        }],
        max_tokens: request.options.maxTokens,
      });

      const extractedData = safeJsonParse(response.response || '{}');
      
      return {
        documentType: request.docType,
        extractedData,
        confidence: calculateConfidence(extractedData),
        processingTime: Date.now(), // This should be actual processing time
        metadata: {
          imageSize: request.image.size,
          imageType: request.image.type
        }
      };
    },

    async faceSearch(request: FaceSearch): Promise<FaceDetectionResult> {
      const imgB64 = await toBase64(request.image);
      const prompt = 'Detect faces in this image. Return the number of faces and their bounding boxes (x, y, width, height) in JSON format.';

      const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [{ 
          role: 'user', 
          content: [
            { type: 'text', text: prompt }, 
            { type: 'image', image: imgB64 }
          ] 
        }],
        max_tokens: request.options.maxTokens,
      });

      const facesData = safeJsonParse(response.response || '[]');
      const faces = Array.isArray(facesData) ? facesData : [facesData];
      
      return {
        faces: faces.map((face: any) => ({
          boundingBox: face.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
          confidence: face.confidence || request.options.detectionThreshold,
          landmarks: face.landmarks || [],
          attributes: face.attributes || {}
        })),
        confidence: calculateFaceDetectionConfidence(faces),
        faceCount: faces.length,
        processingTime: Date.now()
      };
    },

    async faceVerify(request: FaceVerification): Promise<FaceVerificationResult> {
      const img1B64 = await toBase64(request.image);
      const img2B64 = await toBase64(request.image2!);

      const prompt = `Compare two faces in these images. Return a JSON object with { similarity: number (0-1), isMatch: boolean, description: string }. Image 1: describe age, gender, facial features. Image 2: compare to Image 1.`;

      const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: img1B64 },
              { type: 'image', image: img2B64 },
            ],
          },
        ],
        max_tokens: request.options.maxTokens,
      });

      const result = safeJsonParse(response.response || '{"similarity": 0, "isMatch": false, "description": "No description provided"}');
      const similarity = result.similarity || 0;
      const isMatch = similarity >= request.options.similarityThreshold;
      
      return {
        similarity,
        isMatch,
        details: result.description || 'No description provided',
        confidence: calculateFaceVerificationConfidence(similarity),
        attributes: result.attributes || {},
        processingTime: Date.now()
      };
    },

    async livenessDetection(request: LivenessDetection): Promise<LivenessResult> {
      const imgB64 = await toBase64(request.image);
      
      const prompt = request.isVideo
        ? 'Analyze this image as a frame from a video for liveness detection. Detect signs of a live person (e.g., blinks, head turns). Return { isLive: boolean, details: string, spoofType: string, riskScore: number } in JSON format.'
        : 'Analyze this image to detect if it is a live face or a spoof (e.g., photo, screen, mask). Return { isLive: boolean, details: string, spoofType: string, riskScore: number } in JSON format.';

      const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [{ 
          role: 'user', 
          content: [
            { type: 'text', text: prompt }, 
            { type: 'image', image: imgB64 }
          ] 
        }],
        max_tokens: request.options.maxTokens,
      });

      const result = safeJsonParse(response.response || '{"isLive": false, "details": "No liveness detected", "riskScore": 0.8}');
      
      return {
        isLive: result.isLive || false,
        details: result.details || 'No details provided',
        confidence: 1 - (result.riskScore || 0.8),
        spoofType: result.spoofType,
        riskScore: result.riskScore,
        processingTime: Date.now(),
        recommendations: result.recommendations || []
      };
    }
  };
}

