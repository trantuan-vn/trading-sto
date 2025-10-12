import { Buffer } from 'buffer';
import jwt from '@tsndr/cloudflare-worker-jwt';

export type JwtPayload = {
  sub: string;
  identifier?: string; // Optional for refresh tokens
  exp?: number;
  iat?: number;
  type?: string; // For refresh tokens, access tokens, etc.
};
// Hàm verify JWT đơn giản (HMAC-SHA256)
export async function verifyJWT(token: string, secret: string): Promise<{
  ok: boolean;
  payload?: JwtPayload;
  error?: string;
}> {
  try {
    const isValid = await jwt.verify(token, secret);
    if (!isValid) {
      return { ok: false, error: 'Invalid token' };
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.payload) {
      return { ok: false, error: 'Invalid token payload' };
    }

    return { ok: true, payload: decoded.payload as JwtPayload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Token verification failed'
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = { 'Content-Type': 'application/json' };
    const url = new URL(request.url);

    // Kiểm tra header Authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401, headers });
    }

    const token = authHeader.replace('Bearer ', '');
    const result = await verifyJWT(token, env.JWT_SECRET);
    if (!result.ok) {
      return new Response(JSON.stringify({ error: 'Invalid JWT token' }), { status: 401, headers });
    }

    // Kiểm tra method
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers });
    }

    // Xử lý form data
    const formData = await request.formData();
    const image = formData.get('image') as File; // Ảnh chính
    const image2 = formData.get('image2') as File | null; // Ảnh tham chiếu
    const docType = (formData.get('type') as string) || 'general'; // e.g., 'driver', 'cmt', 'cccd', 'passport'
    const isVideo = formData.has('video'); // Cờ báo frame từ video

    if (!image) {
      return new Response(JSON.stringify({ error: 'Missing image' }), { status: 400, headers });
    }

    // Kiểm tra loại file
    if (!['image/jpeg', 'image/png'].includes(image.type)) {
      return new Response(JSON.stringify({ error: 'Invalid file type. Only JPEG/PNG images are supported.' }), { status: 400, headers });
    }

    // Helper: Chuyển File sang base64
    const toBase64 = async (img: File): Promise<string> => {
      try {
        const buffer = await img.arrayBuffer();
        return `data:${img.type};base64,${Buffer.from(buffer).toString('base64')}`;
      } catch {
        throw new Error('Failed to process image');
      }
    };

    const model = '@cf/meta/llama-3.2-11b-vision-instruct';

    try {
      const imgB64 = await toBase64(image);
      const img2B64 = image2 ? await toBase64(image2) : null;

      if (url.pathname === '/recognize-document') {
        // OCR: Trích xuất dữ liệu từ tài liệu
        let prompt = 'Extract structured data (JSON format) from this document image: ';
        if (docType === 'driver') {
          prompt += 'Vietnamese Driver\'s License - return { name, license_number, dob, expiry, address } in Vietnamese.';
        } else if (docType === 'cmt') {
          prompt += 'Vietnamese CMND - return { full_name, id_number, dob, expire_date, place } in Vietnamese.';
        } else if (docType === 'cccd_front') {
          prompt += 'Vietnamese CCCD - return { full_name, id_number, dob, expire_date, address } in Vietnamese.';
        } else if (docType === 'cccd_back') {
          prompt += 'Vietnamese CCCD - return { issue_date, issue_address } in Vietnamese.';
        } else if (docType === 'passport') {
          prompt += 'Passport - return { full_name, passport_number, nationality, dob, expiry_date, issue_date }.';
        } else {
          prompt += 'General ID document - identify type and return { type, name, id_number, dob }.';
        }

        const response = await env.AI.run(model, {
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', image: imgB64 }] }],
          max_tokens: 500,
        });

        return new Response(
          JSON.stringify({
            documentType: docType,
            extractedData: JSON.parse(response.response || '{}'),
            confidence: 0.9, // Placeholder
          }),
          { status: 200, headers }
        );

      } else if (url.pathname === '/face-search') {
        // Face detection
        const prompt = 'Detect faces in this image. Return the number of faces and their bounding boxes (x, y, width, height) in JSON format.';
        const response = await env.AI.run(model, {
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', image: imgB64 }] }],
          max_tokens: 200,
        });

        return new Response(
          JSON.stringify({
            faces: JSON.parse(response.response || '[]'),
            confidence: 0.9, // Placeholder
          }),
          { status: 200, headers }
        );

      } else if (url.pathname === '/face-verify') {
        if (!img2B64) {
          return new Response(JSON.stringify({ error: 'Missing second image for verification' }), { status: 400, headers });
        }

        const prompt = `Compare two faces in these images. Return a JSON object with { similarity: number (0-1), isMatch: boolean, description: string }. Image 1: describe age, gender, facial features. Image 2: compare to Image 1.`;
        const response = await env.AI.run(model, {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image', image: imgB64 },
                { type: 'image', image: img2B64 },
              ],
            },
          ],
          max_tokens: 300,
        });

        const result = JSON.parse(response.response || '{"similarity": 0, "isMatch": false, "description": "No description provided"}');
        return new Response(
          JSON.stringify({
            similarity: result.similarity || 0.8,
            isMatch: result.isMatch || false,
            details: result.description || 'No description provided',
            confidence: 0.9, // Placeholder
          }),
          { status: 200, headers }
        );

      } else if (url.pathname === '/liveness') {
        // Liveness detection: Chỉ xử lý ảnh tĩnh hoặc frame từ video
        const prompt = isVideo
          ? 'Analyze this image as a frame from a video for liveness detection. Detect signs of a live person (e.g., blinks, head turns). Return { isLive: boolean, details: string } in JSON format.'
          : 'Analyze this image to detect if it is a live face or a spoof (e.g., photo, screen). Return { isLive: boolean, details: string } in JSON format.';
        const response = await env.AI.run(model, {
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', image: imgB64 }] }],
          max_tokens: 200,
        });

        const result = JSON.parse(response.response || '{"isLive": false, "details": "No liveness detected"}');
        return new Response(
          JSON.stringify({
            isLive: result.isLive || false,
            details: result.details || 'No details provided',
            confidence: 0.9, // Placeholder
          }),
          { status: 200, headers }
        );
      }

      return new Response('Endpoint not found', { status: 404, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: `Processing failed: ${(error as Error).message}` }), { status: 500, headers });
    }
  },
} satisfies ExportedHandler<Env>;
