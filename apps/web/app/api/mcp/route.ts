import { handleRemoteMcpRequest, McpAuthError, authChallenge } from "@skippy/mcp-server/remote";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  try {
    if (!token) throw new McpAuthError(401, "invalid_token");
    const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) throw new McpAuthError(503, "mcp_not_configured");
    return await handleRemoteMcpRequest(request, { convexUrl, bearerToken: token });
  } catch (error) {
    const status = error instanceof McpAuthError ? error.status : 500;
    const code = error instanceof McpAuthError ? error.code : "mcp_request_failed";
    let challenge = "Bearer";
    try { challenge = authChallenge(status === 401 || status === 403 ? code : undefined); } catch { /* misconfiguration */ }
    return Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store", ...(status === 401 || status === 403 ? { "WWW-Authenticate": challenge } : {}) } });
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
