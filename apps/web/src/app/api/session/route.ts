import { NextRequest, NextResponse } from "next/server";

import { getToken } from "next-auth/jwt";

export async function GET(request: NextRequest) {
  try {
    // In a real implementation, you would check the user's session
    // For this example, we'll check for a NextAuth token
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      address: token.sub,
      chainId: 1, // You might want to store chainId in the token
    });
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(null);
  }
}
