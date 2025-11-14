// Helper middleware for form data processing
export const processFormData = async (c: any) => {
    const formData = await c.req.formData();
    const image = formData.get('image') as File;
    const image2 = formData.get('image2') as File | null;
    const docType = (formData.get('type') as string) || 'general';
    const isVideo = formData.has('video');

    // Validation
    if (!image) {
        throw new Error('Missing image');
    }

    if (!['image/jpeg', 'image/png'].includes(image.type)) {
        throw new Error('Invalid file type. Only JPEG/PNG images are supported.');
    }

    return { image, image2, docType, isVideo };
};

// Helper functions
export async function toBase64(img: File): Promise<string> {
  try {
    const buffer = await img.arrayBuffer();
    return `data:${img.type};base64,${Buffer.from(buffer).toString('base64')}`;
  } catch {
    throw new Error('Failed to process image');
  }
}

export function getDocumentPrompt(docType: string): string {
  const prompts: Record<string, string> = {
    driver: 'Vietnamese Driver\'s License - return { name, license_number, dob, expiry, address } in Vietnamese.',
    cmt: 'Vietnamese CMND - return { full_name, id_number, dob, expire_date, place } in Vietnamese.',
    cccd_front: 'Vietnamese CCCD - return { full_name, id_number, dob, expire_date, address } in Vietnamese.',
    cccd_back: 'Vietnamese CCCD - return { issue_date, issue_address } in Vietnamese.',
    passport: 'Passport - return { full_name, passport_number, nationality, dob, expiry_date, issue_date }.'
  };

  const basePrompt = 'Extract structured data (JSON format) from this document image: ';
  return basePrompt + (prompts[docType] || 'General ID document - identify type and return { type, name, id_number, dob }.');
}

export function safeJsonParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch {
    return {};
  }
}

export function calculateConfidence(extractedData: any): number {
  // Simple confidence calculation based on number of fields extracted
  const fields = Object.keys(extractedData).length;
  return Math.min(fields / 5, 0.95); // Max 95% confidence
}

export function calculateFaceDetectionConfidence(faces: any[]): number {
  if (faces.length === 0) return 0;
  const avgConfidence = faces.reduce((sum, face) => sum + (face.confidence || 0), 0) / faces.length;
  return avgConfidence;
}

export function calculateFaceVerificationConfidence(similarity: number): number {
  // Higher similarity = higher confidence
  return Math.min(similarity * 1.2, 0.95);
}  
