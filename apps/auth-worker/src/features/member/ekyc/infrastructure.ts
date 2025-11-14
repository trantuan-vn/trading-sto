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
import { ServiceSchema, ServiceUsageSchema } from '../../admin/service/domain';

import { toBase64, safeJsonParse, calculateConfidence, getDocumentPrompt, 
  calculateFaceDetectionConfidence, calculateFaceVerificationConfidence } from './utils';

import { UserDO } from '../../ws/infrastructure/UserDO';  

export function createAIService(userDO: UserDO): IAIDocumentService {
  
  const services = userDO.table('services', ServiceSchema, { userScoped: true });
  const serviceUsages = userDO.table('service_usages', ServiceUsageSchema, { userScoped: true });

  // Helper function to validate service usage
  async function validateEndpoint(endpoint: string) {
    const service = await services.where('endpoint','==', endpoint).first();
    if (!service ) {
      throw new Error('Service not found');
    }
    if (!service.isActive) {
      throw new Error('Inactive service');
    }
    if (service.endpoint != endpoint) {
      throw new Error('Endpoint not allowed for this service');
    }
    if (service.currentCalls >= service.maxCalls) {
      throw new Error('Service quota exceeded');
    }
  }
  async function updateService(endpoint: string, operator: string) {
    const service = await services.where('endpoint','==', endpoint).first();
    if (!service ) {
      throw new Error('Service not found');
    }
    if (operator === '+') {
      await services.update(service.id, {
        ...service,
        currentCalls: service.currentCalls + 1,
      });
    } else if (operator === '-') {
      await services.update(service.id, {
        ...service,
        currentCalls: service.currentCalls - 1,
      });
    } else {
      throw new Error('Invalid operator');
    }
  }

  async function createServiceUsage(endpoint: string, ipAddress: string, userAgent: string): Promise<any> {
    const service = await services.where('endpoint','==', endpoint).first();
    if (!service ) {
      throw new Error('Service not found');
    }
    const serviceUsage = await serviceUsages.create({
      serviceId: service.id,
      endpoint: endpoint,
      timestamp: new Date().toISOString(),
      userAgent: userAgent,
      ipAddress: ipAddress,
    });
    return serviceUsage;
  }

  return {
    async recognizeDocument(request: DocumentRecognition): Promise<DocumentExtractionResult> {      
      let isCalled = false;
      try {
        await validateEndpoint(request.endpoint);
        await updateService(request.endpoint,"+");
        isCalled = true;

        const imgB64 = await toBase64(request.image);
        const prompt = getDocumentPrompt(request.docType);

        const response = await userDO.getEnv().AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
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

        await createServiceUsage(request.endpoint, request.ipAddress, request.userAgent);

        return {
          documentType: request.docType,
          extractedData,
          confidence: calculateConfidence(extractedData),
          processingTime: Date.now(), 
          metadata: {
            imageSize: request.image.size,
            imageType: request.image.type
          }
        };

      }
      catch (e) {
        if (isCalled) {
          await updateService(request.endpoint,"-");
        }
        throw e;
      }
    },

    async faceSearch(request: FaceSearch): Promise<FaceDetectionResult> {
      let isCalled = false;
      try {
        await validateEndpoint(request.endpoint);
        await updateService(request.endpoint,"+");
        isCalled = true;
        const imgB64 = await toBase64(request.image);
        const prompt = 'Detect faces in this image. Return the number of faces and their bounding boxes (x, y, width, height) in JSON format.';

        const response = await userDO.getEnv().AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
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

        await createServiceUsage(request.endpoint, request.ipAddress, request.userAgent);

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
      }
      catch (e) {
        if (isCalled) {
          await updateService(request.endpoint,"-");
        }
        throw e;
      }        
    },

    async faceVerify(request: FaceVerification): Promise<FaceVerificationResult> {
      let isCalled = false;
      try {
        await validateEndpoint(request.endpoint);
        await updateService(request.endpoint,"+");
        isCalled = true;

        const img1B64 = await toBase64(request.image);
        const img2B64 = await toBase64(request.image2!);

        const prompt = `Compare two faces in these images. Return a JSON object with { similarity: number (0-1), isMatch: boolean, description: string }. Image 1: describe age, gender, facial features. Image 2: compare to Image 1.`;

        const response = await userDO.getEnv().AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
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

        await createServiceUsage(request.endpoint, request.ipAddress, request.userAgent);
        
        return {
          similarity,
          isMatch,
          details: result.description || 'No description provided',
          confidence: calculateFaceVerificationConfidence(similarity),
          attributes: result.attributes || {},
          processingTime: Date.now()
        };
      }
      catch (e) {
        if (isCalled) {
          await updateService(request.endpoint,"-");
        }
        throw e;
      }        
    },

    async livenessDetection(request: LivenessDetection): Promise<LivenessResult> {
      let isCalled = false;
      try {
        await validateEndpoint(request.endpoint);
        await updateService(request.endpoint,"+");
        isCalled = true;

        const imgB64 = await toBase64(request.image);
        
        const prompt = request.isVideo
          ? 'Analyze this image as a frame from a video for liveness detection. Detect signs of a live person (e.g., blinks, head turns). Return { isLive: boolean, details: string, spoofType: string, riskScore: number } in JSON format.'
          : 'Analyze this image to detect if it is a live face or a spoof (e.g., photo, screen, mask). Return { isLive: boolean, details: string, spoofType: string, riskScore: number } in JSON format.';

        const response = await userDO.getEnv().AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
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

        await createServiceUsage(request.endpoint, request.ipAddress, request.userAgent);
                
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
      catch (e) {
        if (isCalled) {
          await updateService(request.endpoint,"-");
        }
        throw e;
      }        
    }
  };
}