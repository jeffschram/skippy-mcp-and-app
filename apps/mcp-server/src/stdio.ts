#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { hashMcpToken } from "@skippy/shared";
import { bridgeCall } from "./bridge-client.js";
import { createMcpServer } from "./mcp-server.js";
import { createConvexSkippyClient } from "./skippy-client.js";
const convexUrl = process.env.SKIPPY_CONVEX_URL;
const token = process.env.SKIPPY_MCP_TOKEN;
const secret = process.env.SKIPPY_MCP_BRIDGE_SECRET;
if (!convexUrl || !token || !secret) throw new Error("SKIPPY_CONVEX_URL, SKIPPY_MCP_TOKEN and SKIPPY_MCP_BRIDGE_SECRET are required for stdio");
const connection = { secret, principal: { kind: "static" as const, tokenHash: await hashMcpToken(token) } };
const identity = await bridgeCall(convexUrl, connection, "$identity", {});
const client = createConvexSkippyClient(convexUrl, connection);
await createMcpServer(client, identity.brainInstanceId, { role: identity.role }).connect(new StdioServerTransport());
