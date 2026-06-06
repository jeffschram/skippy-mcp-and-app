import { handleRemoteMcpRequest } from "@skippy/mcp-server/remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

async function handle(request: Request) {
  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return Response.json({ error: "Bearer token is required" }, { status: 401 });
  }

  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json({ error: "CONVEX_URL is required for remote MCP" }, { status: 500 });
  }

  try {
    const options = {
      convexUrl,
      bearerToken,
    };
    if (process.env.CONVEX_AUTH_TOKEN) {
      return await handleRemoteMcpRequest(request, {
        ...options,
        convexAuthToken: process.env.CONVEX_AUTH_TOKEN,
      });
    }

    return await handleRemoteMcpRequest(request, options);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "MCP request failed" },
      { status: 401 },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
