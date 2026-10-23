import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
import { signMcpEnvelope, type McpPrincipal } from "@skippy/shared";
export type BridgeConnection = { principal: McpPrincipal; secret: string };
export async function bridgeCall(url: string, connection: BridgeConnection, operation: string, args: Record<string, unknown>) {
  const signed = await signMcpEnvelope({ version: 1, audience: "skippy-convex-mcp", nonce: crypto.randomUUID(),
    expiresAt: Math.min(Date.now() + 30_000, connection.principal.kind === "oauth" ? connection.principal.expiresAt : Infinity),
    principal: connection.principal, operation, args }, connection.secret);
  return new ConvexHttpClient(url).action(makeFunctionReference<"action">("mcpGateway:call"), signed);
}
export function createBridgeClient(url: string, connection: BridgeConnection): ConvexHttpClient {
  const client = new ConvexHttpClient(url);
  const invoke = (ref: any, args: any) => bridgeCall(url, connection, getFunctionName(ref), args ?? {});
  client.query = invoke; client.mutation = invoke; client.action = invoke;
  return client;
}
