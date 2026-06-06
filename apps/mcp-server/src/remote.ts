import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp-server.js";
import { createConvexSkippyClient } from "./skippy-client.js";

const authenticateMcpTokenRef = makeFunctionReference<"mutation">("mcpTokens:authenticate");

export type RemoteMcpOptions = {
  convexUrl: string;
  convexAuthToken?: string;
  bearerToken: string;
};

export async function handleRemoteMcpRequest(request: Request, options: RemoteMcpOptions) {
  const convex = new ConvexHttpClient(options.convexUrl);
  if (options.convexAuthToken) {
    convex.setAuth(options.convexAuthToken);
  }

  const authResult = (await convex.mutation(authenticateMcpTokenRef, {
    token: options.bearerToken,
  })) as { brainInstanceId: string };

  const skippyClient = createConvexSkippyClient(options.convexUrl, options.convexAuthToken);
  const server = createMcpServer(skippyClient, authResult.brainInstanceId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return await transport.handleRequest(request);
}
