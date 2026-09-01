#!/usr/bin/env node
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { authorize, createCredentialLoader, createDiskStore, createTokenSource } from "./auth.js";
import { configDir } from "./config.js";
import { createGcalWriteMcpServer } from "./mcp-server.js";

// GCAL_WRITE_MCP_CONFIG_DIR exists for testing against a scratch credential
// set; production reads ~/.config/gcal-write-mcp.
const dir = configDir(homedir(), process.env["GCAL_WRITE_MCP_CONFIG_DIR"]);

if (process.argv.includes("--authorize")) {
  // Owner-only, interactive, and unreachable from the MCP surface: consent is
  // never something an agent can trigger.
  await authorize(dir);
  process.exit(0);
}

// Credentials are loaded lazily so a missing token.json surfaces as a per-call
// error with setup guidance instead of crashing the server at registration
// time (which would show up as a confusing "failed to connect").
const tokens = createTokenSource({
  credentials: createCredentialLoader(dir),
  store: createDiskStore(dir),
});

const server = createGcalWriteMcpServer(tokens);
await server.connect(new StdioServerTransport());
