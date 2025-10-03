import { NextResponse, type NextRequest } from "next/server";

import { verifyJWT } from "@/lib/utils";

export async function authMiddleware(req: NextRequest) {
  // ✅ Truy cập JWT_SECRET từ cả .env và wrangler.jsonc
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("JWT_SECRET is not defined in environment variables");
    return NextResponse.redirect(new URL("/auth/v3/login", req.url));
  }

  const { pathname } = req.nextUrl;
  let isLoggedIn = false;
  const token = req.cookies.get("token");
  const tokenVerificationResult = token ? await verifyJWT(token.value, jwtSecret) : { ok: false };
  isLoggedIn = tokenVerificationResult.ok;
  if (!tokenVerificationResult.ok){
    const refreshToken = req.cookies.get("refreshToken");
    const refreshTokenVerificationResult = refreshToken ? await verifyJWT(refreshToken.value, jwtSecret) : { ok: false };
    isLoggedIn = refreshTokenVerificationResult.ok;
  }

  if (!isLoggedIn && pathname.startsWith("/dashboard")) {
    console.log(`Redirecting to login page due to unauthenticated request to ${pathname}`);
    return NextResponse.redirect(new URL("/auth/v3/login", req.url));
  }

  if (isLoggedIn && pathname === "/auth/v3/login") {
    console.log(`Redirecting to dashboard due to authenticated request to ${pathname}`);
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  console.log(`Auth middleware: Request to ${pathname} is ${isLoggedIn ? "" : "not"} authenticated.`);
  return NextResponse.next();
}