#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createImessageMcpServer } from "./mcp-server.js";
import { defaultDbPath, openMessagesDb } from "./db.js";

// IMESSAGE_DB_PATH exists for tests/fixtures; production always reads the
// live archive under the invoking user's home directory.
const dbPath = process.env.IMESSAGE_DB_PATH ?? defaultDbPath();

const server = createImessageMcpServer(() => openMessagesDb(dbPath));
await server.connect(new StdioServerTransport());
