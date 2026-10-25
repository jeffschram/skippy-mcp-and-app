import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ bridge: vi.fn(), oauth: vi.fn(), create: vi.fn(), client: vi.fn(), connect: vi.fn(), handle: vi.fn() }));
vi.mock("./bridge-client.js", () => ({ bridgeCall: mocks.bridge }));
vi.mock("./oauth.js", async importOriginal => ({ ...await importOriginal<typeof import("./oauth.js")>(), verifyOAuthToken: mocks.oauth }));
vi.mock("./mcp-server.js", () => ({ createMcpServer: mocks.create }));
vi.mock("./skippy-client.js", () => ({ createConvexSkippyClient: mocks.client }));
vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({ WebStandardStreamableHTTPServerTransport: class { handleRequest = mocks.handle; } }));
import { handleRemoteMcpRequest } from "./remote";
describe("remote MCP authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("SKIPPY_MCP_BRIDGE_SECRET", "a".repeat(32));
    mocks.bridge.mockResolvedValue({ brainInstanceId: "brain", role: "finance" });
    mocks.create.mockReturnValue({ connect: mocks.connect }); mocks.client.mockReturnValue({}); mocks.handle.mockResolvedValue(new Response("ok"));
  });
  afterEach(() => vi.unstubAllEnvs());
  const request = () => handleRemoteMcpRequest(new Request("https://skippy.test/api/mcp"), { convexUrl: "https://convex.test", bearerToken: "secret" });
  it("resolves static-token identity and retains its role", async () => {
    await request(); expect(mocks.oauth).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({}, "brain", { role: "finance", oauth: undefined });
    expect(mocks.bridge.mock.calls[0]?.[1].principal.tokenHash).not.toBe("secret");
  });
  it("resolves OAuth identity in Convex rather than from arguments", async () => {
    const principal = { kind: "oauth", subject: "clerk-user", scopes: ["skippy:read", "skippy:write"] };
    mocks.bridge.mockRejectedValueOnce(new ConvexError({ code: "invalid_static_token" })).mockResolvedValueOnce({ brainInstanceId: "oauth-brain" }); mocks.oauth.mockResolvedValue(principal);
    await request(); expect(mocks.create).toHaveBeenCalledWith({}, "oauth-brain", { role: undefined, oauth: principal });
  });
  it("never creates a server for invalid tokens", async () => {
    mocks.bridge.mockRejectedValue(new ConvexError({ code: "invalid_static_token" })); mocks.oauth.mockRejectedValue(new Error("invalid_token"));
    await expect(request()).rejects.toThrow("invalid_token"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("denies OAuth accounts that have no owned brain", async () => {
    mocks.bridge.mockRejectedValueOnce(new ConvexError({ code: "invalid_static_token" })).mockRejectedValueOnce(new ConvexError({ code: "account_not_authorized" })); mocks.oauth.mockResolvedValue({ kind: "oauth" });
    await expect(request()).rejects.toMatchObject({ status: 403 }); expect(mocks.create).not.toHaveBeenCalled();
  });
});
