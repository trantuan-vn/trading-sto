import { NextRequest, NextResponse } from "next/server";

import jwt from "jsonwebtoken";
import { verifyMessage, getAddress } from "viem";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    let message: string;
    let signature: string;

    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      "signature" in body
    ) {
      ({ message, signature } = body as { message: string; signature: string });
    } else {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const addressMatch = message.match(/Wallet address:\n(0x[a-fA-F0-9]{40})/);
    if (!addressMatch) {
      return NextResponse.json(
        { error: "Invalid message format" },
        { status: 400 }
      );
    }

    const address = addressMatch[1];

    const isValid = await verifyMessage({
      address: getAddress(address),
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Generate sessionId
    const sessionId = crypto.randomUUID();

    // Generate JWT with sessionId
    const token = jwt.sign(
      { address, chainId: 1, sessionId },
      process.env.JWT_SECRET ?? "your-secret-key",
      { expiresIn: "24h" }
    );

    const response = NextResponse.json({ success: true, address, sessionId });
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60, // 24 hours
      path: "/",
    });

    // Clear nonce cookie after successful verification
    response.cookies.delete("nonce");

    return response;
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json(
      { error: "Failed to verify signature" },
      { status: 500 }
    );
  }
}