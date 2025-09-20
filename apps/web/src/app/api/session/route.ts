import { NextRequest, NextResponse } from "next/server";

import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json(null, { status: 401 });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET ?? "your-secret-key") as {
        address: string;
        chainId: number;
      };

      return NextResponse.json({
        address: decoded.address,
        chainId: decoded.chainId,
      });
    } catch (error) {
      console.error("Token verification error:", error);
      return NextResponse.json(null, { status: 401 });
    }
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(null, { status: 500 });
  }
}
