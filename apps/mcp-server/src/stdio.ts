#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { createConvexSkippyClient } from "./skippy-client.js";

const convexUrl = process.env.SKIPPY_CONVEX_URL;
const brainInstanceId = process.env.SKIPPY_BRAIN_INSTANCE_ID;
const authToken = process.env.SKIPPY_CONVEX_AUTH_TOKEN;

if (!convexUrl) {
  throw new Error("SKIPPY_CONVEX_URL is required");
}

if (!brainInstanceId) {
  throw new Error("SKIPPY_BRAIN_INSTANCE_ID is required");
}

const client = createConvexSkippyClient(convexUrl, authToken);
const server = createMcpServer(client, brainInstanceId);
await server.connect(new StdioServerTransport());
