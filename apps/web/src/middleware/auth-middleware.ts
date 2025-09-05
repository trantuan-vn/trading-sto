import { NextResponse, type NextRequest } from "next/server";

export function authMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLoggedIn = req.cookies.get("access-token");

  if (!isLoggedIn && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/en-US/auth/login", req.url));
  }

  if (isLoggedIn && pathname === "/en/auth/login") {
    return NextResponse.redirect(new URL("/en-US/dashboard", req.url));
  }

  return NextResponse.next();
}
