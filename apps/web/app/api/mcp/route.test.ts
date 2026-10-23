import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@skippy/mcp-server/remote", () => {
  class McpAuthError extends Error { constructor(public status: number, public code: string) { super(code); } }
  return { McpAuthError, authChallenge: (code: string) => `Bearer resource_metadata="https://skippy.test/.well-known/oauth-protected-resource", error="${code}"`, handleRemoteMcpRequest: vi.fn() };
});
import { handleRemoteMcpRequest, McpAuthError } from "@skippy/mcp-server/remote";
import { GET, POST } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("MCP HTTP auth errors", () => {
  it("challenges unauthenticated requests without reaching private operations", async () => {
    const response = await GET(new Request("https://skippy.test/api/mcp"));
    expect(response.status).toBe(401); expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
    expect(handleRemoteMcpRequest).not.toHaveBeenCalled();
  });
  it("returns 403 for insufficient scope and does not leak unexpected errors", async () => {
    vi.stubEnv("CONVEX_URL", "https://convex.test");
    const request = () => new Request("https://skippy.test/api/mcp", { method: "POST", headers: { authorization: "Bearer token" } });
    vi.mocked(handleRemoteMcpRequest).mockRejectedValueOnce(new McpAuthError(403, "insufficient_scope"));
    const forbidden = await POST(request()); expect(forbidden.status).toBe(403); expect(forbidden.headers.get("www-authenticate")).toContain("insufficient_scope");
    vi.mocked(handleRemoteMcpRequest).mockRejectedValueOnce(new Error("sensitive backend details"));
    const failed = await POST(request()); expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("sensitive");
  });
});
