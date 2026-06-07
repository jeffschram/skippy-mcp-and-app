import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convexConstructor: vi.fn(),
  convexMutation: vi.fn(),
  convexSetAuth: vi.fn(),
  createMcpServer: vi.fn(),
  createSkippyClient: vi.fn(),
  serverConnect: vi.fn(),
  transportConstructor: vi.fn(),
  transportHandleRequest: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: mocks.convexConstructor,
}));

vi.mock("./mcp-server.js", () => ({
  createMcpServer: mocks.createMcpServer,
}));

vi.mock("./skippy-client.js", () => ({
  createConvexSkippyClient: mocks.createSkippyClient,
}));

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: mocks.transportConstructor,
}));

describe("remote MCP transport authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.convexConstructor.mockImplementation(function ConvexHttpClient() {
      return {
      mutation: mocks.convexMutation,
      setAuth: mocks.convexSetAuth,
      };
    });
    mocks.convexMutation.mockResolvedValue({ brainInstanceId: "brain_123" });
    mocks.createSkippyClient.mockReturnValue({ skippy: true });
    mocks.createMcpServer.mockReturnValue({ connect: mocks.serverConnect });
    mocks.transportConstructor.mockImplementation(function WebStandardStreamableHTTPServerTransport() {
      return {
        handleRequest: mocks.transportHandleRequest,
      };
    });
    mocks.transportHandleRequest.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("authenticates the bearer token before creating a brain-scoped server", async () => {
    const { handleRemoteMcpRequest } = await import("./remote");
    const request = new Request("https://skippy.test/api/mcp", { method: "POST" });

    const response = await handleRemoteMcpRequest(request, {
      convexUrl: "https://convex.test",
      convexAuthToken: "convex-auth",
      bearerToken: "skippy-secret",
    });

    expect(response.status).toBe(200);
    expect(mocks.convexConstructor).toHaveBeenCalledWith("https://convex.test");
    expect(mocks.convexSetAuth).toHaveBeenCalledWith("convex-auth");
    expect(mocks.convexMutation).toHaveBeenCalledWith(expect.anything(), { token: "skippy-secret" });
    expect(mocks.createSkippyClient).toHaveBeenCalledWith("https://convex.test", "convex-auth");
    expect(mocks.createMcpServer).toHaveBeenCalledWith({ skippy: true }, "brain_123");
    expect(mocks.serverConnect).toHaveBeenCalledWith(expect.objectContaining({ handleRequest: expect.any(Function) }));
    expect(mocks.transportHandleRequest).toHaveBeenCalledWith(request);
  });

  it("does not create a server when token authentication fails", async () => {
    const { handleRemoteMcpRequest } = await import("./remote");
    mocks.convexMutation.mockRejectedValueOnce(new Error("invalid MCP token"));

    await expect(
      handleRemoteMcpRequest(new Request("https://skippy.test/api/mcp"), {
        convexUrl: "https://convex.test",
        bearerToken: "bad-token",
      }),
    ).rejects.toThrow("invalid MCP token");

    expect(mocks.createSkippyClient).not.toHaveBeenCalled();
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
    expect(mocks.transportHandleRequest).not.toHaveBeenCalled();
  });
});
