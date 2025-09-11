import { NextRequest, NextResponse } from "next/server";

import { verifyMessage, getAddress } from "viem";

export async function POST(request: NextRequest) {
  try {
    const { message, signature } = await request.json();

    // Extract address from the message
    const addressMatch = message.match(/Wallet address:\n(0x[a-fA-F0-9]{40})/);
    if (!addressMatch) {
      return NextResponse.json(
        { error: "Invalid message format" },

        { status: 400 },
      );
    }

    const address = addressMatch[1];

    // Verify the signature
    const isValid = await verifyMessage({
      address: getAddress(address),
      message,
      signature,
    });

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },

        { status: 401 },
      );
    }

    // Here you would typically:
    // 1. Validate the nonce (from cookie or database)
    // 2. Create a session or JWT token for the user
    // 3. Store the session in your database

    // For demo purposes, we"ll just return a success response
    return NextResponse.json({ success: true, address });
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json(
      { error: "Failed to verify signature" },

      { status: 500 },
    );
  }
}
