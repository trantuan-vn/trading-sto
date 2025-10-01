import { NextResponse, type NextRequest } from "next/server";

export function authMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLoggedIn = req.cookies.get("token");
  console.log(isLoggedIn);
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