import { describe, expect, it } from "vitest";
import { hashMcpToken, signMcpEnvelope, verifyMcpEnvelope, type McpEnvelope } from "./mcp-bridge";
const secret = "test-only-secret".repeat(3);
const envelope = async (): Promise<McpEnvelope> => ({ version: 1, audience: "skippy-convex-mcp", nonce: crypto.randomUUID(), expiresAt: Date.now() + 30_000, principal: { kind: "static", tokenHash: await hashMcpToken("token") }, operation: "projects:projectBoardForBrain", args: { brainInstanceId: "owned" } });
describe("signed MCP boundary", () => {
  it("accepts authentic operation arguments", async () => {
    const value = await envelope(); const signed = await signMcpEnvelope(value, secret);
    expect(await verifyMcpEnvelope(signed.payload, signed.signature, secret)).toEqual(value);
  });
  it("rejects argument, principal, operation and secret tampering", async () => {
    const value = await envelope(); const signed = await signMcpEnvelope(value, secret);
    for (const changed of [{ ...value, args: { brainInstanceId: "other" } }, { ...value, operation: "knowledge:ingestObject" }, { ...value, principal: { kind: "static", tokenHash: "0".repeat(64) } }]) {
      await expect(verifyMcpEnvelope(JSON.stringify(changed), signed.signature, secret)).rejects.toThrow("signature");
    }
    await expect(verifyMcpEnvelope(signed.payload, signed.signature, "another-secret".repeat(3))).rejects.toThrow("signature");
  });
  it("rejects expired, long-lived and wrong-audience envelopes", async () => {
    for (const change of [{ expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 120_000 }, { audience: "other" }]) {
      const signed = await signMcpEnvelope({ ...await envelope(), ...change } as McpEnvelope, secret);
      await expect(verifyMcpEnvelope(signed.payload, signed.signature, secret)).rejects.toThrow("envelope");
    }
  });
  it("does not let the envelope outlive its OAuth token", async () => {
    const value = await envelope(); value.principal = { kind: "oauth", subject: "owner", issuer: "https://issuer", resource: "https://mcp", scopes: ["skippy:read"], expiresAt: Date.now() + 1000 };
    const signed = await signMcpEnvelope(value, secret);
    await expect(verifyMcpEnvelope(signed.payload, signed.signature, secret)).rejects.toThrow("OAuth principal");
  });
});
