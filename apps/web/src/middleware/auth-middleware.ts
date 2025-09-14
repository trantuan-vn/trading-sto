import { NextRequest } from "next/server";

import jwt from "jsonwebtoken";

export interface JwtPayload {
  address: string;
  chainId: number;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface AuthResult {
  success: boolean;
  payload?: JwtPayload;
  error?: string;
  status: number;
}

export async function verifyAuthToken(request: NextRequest): Promise<AuthResult> {
  try {
    const token = request.cookies.get("auth_token")?.value;

    if (!token) {
      return {
        success: false,
        error: "Authentication required: No token provided",
        status: 401,
      };
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET ?? "your-secret-key") as JwtPayload;
      return {
        success: true,
        payload: decoded,
        status: 200,
      };
    } catch (error) {
      console.error("JWT verification error:", error);
      return {
        success: false,
        error: "Authentication failed: Invalid or expired token",
        status: 401,
      };
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}