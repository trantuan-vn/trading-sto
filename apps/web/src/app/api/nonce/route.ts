import { NextRequest, NextResponse } from "next/server";

import { generateNonce } from "siwe";

export async function GET(req: NextRequest) {
  try {
    const nonce = generateNonce();
    const response = NextResponse.json({ nonce });
    response.cookies.set("nonce", nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 5, // 5 minutes
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Nonce generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate nonce" },
      { status: 500 }
    );
  }
}