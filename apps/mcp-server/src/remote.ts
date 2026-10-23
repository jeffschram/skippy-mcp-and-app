import { ConvexError } from "convex/values";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { hashMcpToken } from "@skippy/shared";
import { createMcpServer } from "./mcp-server.js";
import { createConvexSkippyClient } from "./skippy-client.js";
import { bridgeCall, type BridgeConnection } from "./bridge-client.js";
import { verifyOAuthToken, McpAuthError } from "./oauth.js";
export { McpAuthError, authChallenge, protectedResourceMetadata } from "./oauth.js";
export type RemoteMcpOptions = { convexUrl: string; bearerToken: string };
export async function handleRemoteMcpRequest(request: Request, options: RemoteMcpOptions) {
  const secret = process.env.SKIPPY_MCP_BRIDGE_SECRET;
  if (!secret || secret.length < 32) throw new McpAuthError(503, "mcp_not_configured");
  let connection: BridgeConnection = { secret, principal: { kind: "static", tokenHash: await hashMcpToken(options.bearerToken) } };
  let identity: { brainInstanceId: string; role?: string };
  try { identity = await bridgeCall(options.convexUrl, connection, "$identity", {}); }
  catch (error) {
    if (!(error instanceof ConvexError) || (error.data as any)?.code !== "invalid_static_token") throw new McpAuthError(503, "mcp_backend_unavailable");
    connection = { secret, principal: await verifyOAuthToken(options.bearerToken) };
    try { identity = await bridgeCall(options.convexUrl, connection, "$identity", {}); }
    catch (error) {
      if (error instanceof ConvexError && (error.data as any)?.code === "account_not_authorized") throw new McpAuthError(403, "account_not_authorized");
      throw new McpAuthError(503, "mcp_backend_unavailable");
    }
  }
  const client = createConvexSkippyClient(options.convexUrl, connection);
  const server = createMcpServer(client, identity.brainInstanceId, { role: identity.role,
    oauth: connection.principal.kind === "oauth" ? connection.principal : undefined });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
