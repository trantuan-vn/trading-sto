import { NextRequest, NextResponse } from "next/server";

import { generateNonce } from "siwe";

export async function GET(request: NextRequest) {
  try {
    // Generate a nonce for SIWE
    const nonce = generateNonce();

    // Set nonce as a cookie for verification later (optional)
    const response = NextResponse.json(nonce);
    response.cookies.set("nonce", nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 5, // 5 minutes
    });

    return response;
  } catch (error) {
    console.error("Nonce generation error:", error)
    return NextResponse.json(
      { error: "Failed to generate nonce" },

      { status: 500 },
    );
  }
}
