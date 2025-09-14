import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, env: Env) {
  try {
    // Get authenticated data from middleware headers
    const address = request.headers.get("x-auth-address");
    const chainId = request.headers.get("x-auth-chainId");
    const sessionIdFromToken = request.headers.get("x-auth-sessionId");

    if (!address || !chainId || !sessionIdFromToken) {
      return NextResponse.json(
        { success: false, error: "Authentication data missing" },
        { status: 401 }
      );
    }

    // Handle WebSocket connection
    const url = new URL(request.url);
    if (url.pathname === "/api/ws") {
      const sessionIdFromQuery = url.searchParams.get("sessionId");

      // Validate sessionId from query matches JWT
      if (sessionIdFromQuery && sessionIdFromQuery !== sessionIdFromToken) {
        return NextResponse.json(
          { success: false, error: "Invalid session ID" },
          { status: 401 }
        );
      }

      // Use sessionId from token if query param is missing
      const sessionId = sessionIdFromQuery ?? sessionIdFromToken;

      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);

      try {
        const response = await stub.fetch(request);
        return NextResponse.json(
          {
            success: true,
            message: "WebSocket connection established",
            address,
            chainId: parseInt(chainId),
            sessionId,
          },
          { status: 200 }
        );
      } catch (error) {
        console.error("Durable Object fetch error:", error);
        return NextResponse.json(
          { success: false, error: "Failed to establish WebSocket connection" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: "Invalid endpoint" },
      { status: 404 }
    );
  } catch (error) {
    console.error("WebSocket route error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}