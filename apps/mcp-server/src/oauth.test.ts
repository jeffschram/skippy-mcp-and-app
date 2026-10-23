import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
// Exercise real signature verification; only replace the network JWKS lookup.
const state = vi.hoisted(() => ({ publicKey: undefined as any }));
vi.mock("jose", async importOriginal => ({ ...await importOriginal<typeof import("jose")>(), createRemoteJWKSet: () => async () => state.publicKey }));
import { authChallenge, protectedResourceMetadata, verifyOAuthToken } from "./oauth";
let privateKey: CryptoKey;
const issuer = "https://clerk.test"; const resource = "https://skippy.test/api/mcp";
beforeAll(async () => { const keys = await generateKeyPair("RS256"); privateKey = keys.privateKey; state.publicKey = keys.publicKey; });
beforeEach(() => { vi.stubEnv("SKIPPY_MCP_OAUTH_ENABLED", "true"); vi.stubEnv("SKIPPY_MCP_OAUTH_ISSUER", issuer); vi.stubEnv("SKIPPY_MCP_RESOURCE_URL", resource); });
afterEach(() => vi.unstubAllEnvs());
async function token(overrides: Record<string, unknown> = {}, typ = "at+jwt", key = privateKey) {
  return new SignJWT({ scope: "skippy:read skippy:write", sub: "clerk-owner", iss: issuer, aud: resource, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60, ...overrides }).setProtectedHeader({ alg: "RS256", typ }).sign(key);
}
describe("OAuth resource verification", () => {
  it("accepts a signed resource-bound access token", async () => {
    expect(await verifyOAuthToken(await token())).toMatchObject({ subject: "clerk-owner", resource, scopes: ["skippy:read", "skippy:write"] });
  });
  it("rejects wrong audience/issuer, expiry, missing claims, and session/ID tokens", async () => {
    for (const claims of [{ aud: "https://other" }, { iss: "https://other" }, { exp: 1 }, { sub: undefined }]) {
      await expect(verifyOAuthToken(await token(claims))).rejects.toMatchObject({ status: 401 });
    }
    await expect(verifyOAuthToken(await token({}, "JWT"))).rejects.toMatchObject({ status: 401 });
    await expect(verifyOAuthToken("opaque-token")).rejects.toMatchObject({ status: 401 });
    const attacker = await generateKeyPair("RS256");
    await expect(verifyOAuthToken(await token({}, "at+jwt", attacker.privateKey))).rejects.toMatchObject({ status: 401 });
  });
  it("rejects tokens without read permission", async () => {
    await expect(verifyOAuthToken(await token({ scope: "openid" }))).rejects.toMatchObject({ status: 403 });
  });
  it("publishes the exact configured resource and standard challenge", () => {
    expect(protectedResourceMetadata()).toMatchObject({ resource, authorization_servers: [issuer] });
    expect(authChallenge("insufficient_scope")).toContain('resource_metadata="https://skippy.test/.well-known/oauth-protected-resource"');
    expect(authChallenge("insufficient_scope")).toContain('scope="skippy:read skippy:write"');
    vi.stubEnv("SKIPPY_MCP_OAUTH_ENABLED", "false"); expect(protectedResourceMetadata()).toBeUndefined();
  });
});
