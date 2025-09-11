import { NextResponse } from "next/server";

export async function POST() {
  // Clear any session cookies or tokens here
  const response = NextResponse.json({ success: true });
  response.cookies.delete("nonce");
  return response;
}
