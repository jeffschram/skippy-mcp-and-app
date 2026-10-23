/** Private server-to-Convex envelope. This is not an OAuth token or client credential. */
export type McpPrincipal =
  | { kind: "static"; tokenHash: string }
  | { kind: "oauth"; issuer: string; subject: string; resource: string; scopes: string[]; expiresAt: number };
export type McpEnvelope = {
  version: 1; audience: "skippy-convex-mcp"; nonce: string; expiresAt: number;
  principal: McpPrincipal; operation: string; args: Record<string, unknown>;
};
const encoder = new TextEncoder();
async function key(secret: string) {
  if (secret.length < 32) throw new Error("MCP bridge secret must contain at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signMcpEnvelope(envelope: McpEnvelope, secret: string) {
  const payload = JSON.stringify(envelope);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))), b => b.toString(16).padStart(2, "0")).join("");
  return { payload, signature };
}
export async function verifyMcpEnvelope(payload: string, signature: string, secret: string, now = Date.now()): Promise<McpEnvelope> {
  if (payload.length > 1_000_000 || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("Invalid MCP envelope");
  const bytes = Uint8Array.from(signature.match(/../g)!, b => parseInt(b, 16));
  if (!await crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(payload))) throw new Error("Invalid MCP signature");
  const value = JSON.parse(payload) as McpEnvelope;
  if (value.version !== 1 || value.audience !== "skippy-convex-mcp" || typeof value.nonce !== "string" || value.nonce.length < 16 ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 60_000 ||
      typeof value.operation !== "string" || !value.args || Array.isArray(value.args) || typeof value.args !== "object") throw new Error("Invalid MCP envelope");
  if (value.principal?.kind === "oauth") {
    const p = value.principal;
    if (!p.subject || !p.issuer || !p.resource || !Array.isArray(p.scopes) || !p.scopes.every(s => typeof s === "string") || !Number.isFinite(p.expiresAt) || p.expiresAt <= now || value.expiresAt > p.expiresAt) throw new Error("Invalid OAuth principal");
  } else if (value.principal?.kind !== "static" || !/^[a-f0-9]{64}$/.test(value.principal.tokenHash)) throw new Error("Invalid MCP principal");
  return value;
}
export async function hashMcpToken(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))), b => b.toString(16).padStart(2, "0")).join("");
}
