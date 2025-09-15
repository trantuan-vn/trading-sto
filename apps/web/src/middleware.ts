
// import { NextRequest, NextResponse } from "next/server";

// import { verifyAuthToken, AuthResult } from "./middleware/auth-middleware";

// // Define protected routes
// const protectedRoutes = ["/api/ws", "/api/session"];

// export async function middleware(request: NextRequest) {
//   const { pathname } = request.nextUrl;

//   // Skip middleware for non-protected routes
//   if (!protectedRoutes.some((route) => pathname.startsWith(route))) {
//     return NextResponse.next();
//   }

//   // Verify authentication
//   const authResult: AuthResult = await verifyAuthToken(request);

//   if (!authResult.success || !authResult.payload) {
//     return NextResponse.json(
//       { success: false, error: authResult.error },
//       { status: authResult.status }
//     );
//   }

//   // Add authenticated data to request headers
//   const requestHeaders = new Headers(request.headers);
//   requestHeaders.set("x-auth-address", authResult.payload.address);
//   requestHeaders.set("x-auth-chainId", authResult.payload.chainId.toString());
//   requestHeaders.set("x-auth-sessionId", authResult.payload.sessionId);

//   return NextResponse.next({
//     request: {
//       headers: requestHeaders,
//     },
//   });
// }

// export const config = {
//   matcher: ["/api/ws/:path*", "/api/session/:path*"],
// };

import { withAuth } from 'next-auth/middleware';

export default withAuth({
  callbacks: {
    authorized: ({ req, token }) => {
      return !!token;
    },
  },
});

export const config = {
  matcher: ['/api/ws/:path*']
};
