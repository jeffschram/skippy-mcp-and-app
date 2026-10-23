import { createRemoteJWKSet, jwtVerify } from "jose";
import type { McpPrincipal } from "@skippy/shared";
export class McpAuthError extends Error {
  constructor(public status: 401 | 403 | 503, public code: string) { super(code); }
}
export function oauthConfig(env = process.env) {
  if (env.SKIPPY_MCP_OAUTH_ENABLED !== "true") return undefined;
  const issuer = env.SKIPPY_MCP_OAUTH_ISSUER;
  const resource = env.SKIPPY_MCP_RESOURCE_URL;
  if (!issuer || !resource || new URL(issuer).protocol !== "https:" || new URL(resource).protocol !== "https:") throw new McpAuthError(503, "oauth_not_configured");
  return { issuer, resource };
}
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyOAuthToken(token: string): Promise<Extract<McpPrincipal, {kind: "oauth"}>> {
  const config = oauthConfig();
  if (!config) throw new McpAuthError(401, "invalid_token");
  try {
    // Opaque Clerk tokens do not prove the MCP resource audience. Reject them.
    let keys = jwks.get(config.issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(`${config.issuer.replace(/\/$/, "")}/.well-known/jwks.json`)); jwks.set(config.issuer, keys); }
    const { payload, protectedHeader } = await jwtVerify(token, keys, { issuer: config.issuer, audience: config.resource, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"] });
    // Clerk distinguishes access tokens from browser session and OIDC ID tokens by typ.
    if (!["at+jwt", "application/at+jwt"].includes(protectedHeader.typ ?? "")) throw new McpAuthError(401, "invalid_token");
    const rawScopes = Array.isArray(payload.scp) ? payload.scp : typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    const scopes = rawScopes.filter((scope): scope is string => typeof scope === "string");
    if (!scopes.includes("skippy:read")) throw new McpAuthError(403, "insufficient_scope");
    return { kind: "oauth", issuer: config.issuer, resource: config.resource, subject: payload.sub!, scopes, expiresAt: payload.exp! * 1000 };
  } catch (error) {
    if (error instanceof McpAuthError) throw error;
    if (error instanceof TypeError || (error as { code?: string })?.code === "ERR_JWKS_TIMEOUT") throw new McpAuthError(503, "authorization_provider_unavailable");
    throw new McpAuthError(401, "invalid_token");
  }
}
export function protectedResourceMetadata() {
  const config = oauthConfig();
  if (!config) return undefined;
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: ["skippy:read", "skippy:write"], bearer_methods_supported: ["header"] };
}
export function authChallenge(code?: string) {
  const config = oauthConfig();
  const metadata = config ? new URL("/.well-known/oauth-protected-resource", config.resource).href : undefined;
  return `Bearer${metadata ? ` resource_metadata="${metadata}"` : ""}${code ? `${metadata ? "," : ""} error="${code}"` : ""}${code === "insufficient_scope" ? ', scope="skippy:read skippy:write"' : ""}`;
}
