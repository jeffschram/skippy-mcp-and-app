#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { createConvexSkippyClient } from "./skippy-client.js";

const convexUrl = process.env.SKIPPY_CONVEX_URL;
const brainInstanceId = process.env.SKIPPY_BRAIN_INSTANCE_ID;
const authToken = process.env.SKIPPY_CONVEX_AUTH_TOKEN;
// Optional agent-role scope (docs/agents.md): agenda, finance, task-executor,
// or pm / pm:{projectId}. When set, only the role's tools are exposed.
const role = process.env.SKIPPY_MCP_ROLE?.trim();

if (!convexUrl) {
  throw new Error("SKIPPY_CONVEX_URL is required");
}

if (!brainInstanceId) {
  throw new Error("SKIPPY_BRAIN_INSTANCE_ID is required");
}

const client = createConvexSkippyClient(convexUrl, authToken);
const server = role ? createMcpServer(client, brainInstanceId, { role }) : createMcpServer(client, brainInstanceId);
await server.connect(new StdioServerTransport());
