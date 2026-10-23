import { readFileSync } from "node:fs";
import { MCP_OPERATIONS } from "@skippy/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashMcpToken, signMcpEnvelope, type McpPrincipal } from "@skippy/shared";
import { authorize, call } from "./mcpGateway";
const secret = "test-only-bridge-secret".repeat(2);
const nonceRows: any[] = [];
let revoked = false;
const db = {
  get: async (id: string) => id === "brain" ? { _id: "brain", ownerUserId: "owner" } : { brainInstanceId: "other" },
  query: (table: string) => ({ withIndex: (_name: string, fn: any) => {
    const fields: Record<string, any> = {}; const q: any = { eq: (k: string, v: any) => { fields[k] = v; return q; }, lt: () => q }; fn(q);
    return { unique: async () => table === "mcpTokens" ? { brainInstanceId: "brain", revokedAt: revoked ? 1 : undefined, role: "finance" } : table === "users" ? { _id: "owner" } : table === "brainInstances" ? { _id: "brain" } : nonceRows.find(r => r.nonce === fields.nonce), take: async () => [] };
  } }),
  patch: async () => {},
  insert: async (_table: string, row: any) => { nonceRows.push(row); }, delete: async () => {},
};
async function signed(principal?: McpPrincipal, operation = "$identity", args: Record<string, unknown> = {}) {
  return signMcpEnvelope({ version: 1, audience: "skippy-convex-mcp", nonce: crypto.randomUUID(), expiresAt: Date.now()+20_000, principal: principal ?? { kind: "static", tokenHash: await hashMcpToken("token") }, operation, args }, secret);
}
const oauth = (scopes = ["skippy:read"]): McpPrincipal => ({ kind: "oauth", issuer: "https://issuer", resource: "https://resource", subject: "clerk-user", scopes, expiresAt: Date.now()+60_000 });
beforeEach(() => { nonceRows.length = 0; revoked = false; vi.stubEnv("SKIPPY_MCP_BRIDGE_SECRET", secret); vi.stubEnv("SKIPPY_MCP_OAUTH_ENABLED", "true"); vi.stubEnv("SKIPPY_MCP_OAUTH_ISSUER", "https://issuer"); vi.stubEnv("SKIPPY_MCP_RESOURCE_URL", "https://resource"); });
afterEach(() => vi.unstubAllEnvs());
describe("Convex MCP gateway", () => {
  it("rechecks static revocation and rejects replay", async () => {
    const request = await signed();
    expect(await (authorize as any)._handler({ db }, request)).toMatchObject({ brainInstanceId: "brain", role: "finance" });
    await expect((authorize as any)._handler({ db }, request)).rejects.toThrow("already used");
    revoked = true; await expect((authorize as any)._handler({ db }, await signed())).rejects.toThrow("invalid_static_token");
  });
  it("rejects cross-account references before dispatch", async () => {
    await expect((authorize as any)._handler({ db }, await signed(oauth(), "projects:projectBoardForBrain", { projectId: "foreign" }))).rejects.toThrow("Reference not found");
  });
  it("enforces backend OAuth grants and issuer even with a valid bridge signature", async () => {
    await expect((authorize as any)._handler({ db }, await signed(oauth(), "knowledge:createTaskDirect"))).rejects.toThrow("scope");
    await expect((authorize as any)._handler({ db }, await signed({ ...oauth(), issuer: "https://other" } as McpPrincipal))).rejects.toThrow("not allowed");
    expect(await (authorize as any)._handler({ db }, await signed(oauth(["skippy:read", "skippy:write"]), "knowledge:createTaskDirect"))).toMatchObject({ brainInstanceId: "brain" });
  });
  it("never dispatches non-allowlisted operations", async () => {
    const runMutation = vi.fn();
    await expect((call as any)._handler({ runMutation }, await signed(undefined, "users:deleteEverything"))).rejects.toThrow("not allowed");
    expect(runMutation).not.toHaveBeenCalled();
  });
});

it("keeps every gateway target internal so direct Convex calls cannot bypass authorization", () => {
  for (const operation of Object.keys(MCP_OPERATIONS)) {
    const [module, name] = operation.split(":");
    const source = readFileSync(new URL(`./${module}.ts`, import.meta.url), "utf8");
    expect(source).toMatch(new RegExp(`export const ${name} = internal(?:Query|Mutation|Action)Generic`));
  }
});
