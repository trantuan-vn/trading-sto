import { NextRequest, NextResponse } from "next/server";

import { SiweMessage } from "siwe";

import { auth } from "@/app/auth";

export async function POST(req: NextRequest) {
  try {
    const req_body = await req.json();
    const { message, signature } = req_body as { message: string, signature: string };
    const session = await auth();

    // Lấy nonce từ cookie
    const nonce = req.cookies.get("nonce")?.value;
    if (!nonce) {
      return NextResponse.json({ error: "Nonce not found" }, { status: 400 });
    }

    // Verify SIWE
    const siweMessage = new SiweMessage(message);
    const { data: fields } = await siweMessage.verify({ signature });

    if (fields.nonce !== nonce) {
      return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
    }

    // Gọi backend để tạo/cập nhật user
    const response = await fetch("/api/auth/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: fields.address.toLowerCase(),
      }),
    });

    const res_body = await response.json();
    const { userId, token, ethereum_address } = res_body as { userId: string, token: string, ethereum_address: string };

    // Xóa nonce sau khi dùng
    const res = NextResponse.json({ success: true, userId, token, ethereum_address });
    res.cookies.set("nonce", "", { maxAge: 0, path: "/" });

    return res;
  } catch (error) {
    console.error("SIWE verify error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
