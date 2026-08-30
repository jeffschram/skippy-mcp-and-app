// Read-only iMessage MCP server (docs/imessage-source.md).
// Four tools, all reads; there is no send/modify capability anywhere in this
// package, mirroring the "read-only by construction" bar set for the Gmail
// and Calendar connectors.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  describeDbError,
  getThread,
  listChats,
  listRecentMessages,
  searchMessages,
} from "./db.js";

const instructions =
  "Read-only access to the local iMessage archive (~/Library/Messages/chat.db). " +
  "Dates are ISO 8601 UTC. Use list_chats to discover chat identifiers, then " +
  "get_thread for a conversation. Messages with null text are attachment-only " +
  "(images, tapbacks, etc.). This server cannot send or modify anything.";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const sinceField = z
  .string()
  .optional()
  .describe("Only include messages at/after this ISO 8601 timestamp");
const limitField = z.number().int().min(1).max(200).optional();

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolError(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    isError: true,
  };
}

export function createImessageMcpServer(getDb: () => DatabaseSync) {
  const server = new McpServer(
    {
      name: "imessage",
      version: "0.1.0",
    },
    {
      instructions,
    },
  );

  // Open lazily so a TCC denial surfaces as a per-call error with guidance
  // instead of crashing the server at startup.
  let db: DatabaseSync | null = null;
  const run = (fn: (db: DatabaseSync) => unknown) => {
    try {
      db ??= getDb();
      return toolResult(fn(db));
    } catch (error) {
      return toolError(describeDbError(error));
    }
  };

  server.registerTool(
    "list_recent_messages",
    {
      title: "List recent iMessages",
      description:
        "Most recent messages across all conversations, newest first. Filter with `since` (ISO 8601) for incremental reads.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: z.object({
        since: sinceField,
        limit: limitField.describe("Max messages to return (default 50, max 200)"),
      }),
    },
    async (args) => run((d) => listRecentMessages(d, args)),
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search iMessages",
      description:
        "Substring search over message text (including typedstream-only rows), newest first.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: z.object({
        query: z.string().min(1).describe("Substring to search for"),
        since: sinceField,
        limit: limitField.describe("Max messages to return (default 50, max 200)"),
      }),
    },
    async (args) => run((d) => searchMessages(d, args)),
  );

  server.registerTool(
    "get_thread",
    {
      title: "Get a conversation thread",
      description:
        "Messages for one conversation in chronological order. Get chatIdentifier values (phone, email, or chatNNN group id) from list_chats.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: z.object({
        chatIdentifier: z
          .string()
          .min(1)
          .describe("chat_identifier from list_chats, e.g. +15551234567 or chat123456789"),
        since: sinceField,
        limit: limitField.describe("Max messages to return (default 100, max 200)"),
      }),
    },
    async (args) => run((d) => getThread(d, args)),
  );

  server.registerTool(
    "list_chats",
    {
      title: "List conversations",
      description:
        "Conversations ordered by most recent activity, with participants and last-message time.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: z.object({
        limit: limitField.describe("Max chats to return (default 30, max 200)"),
      }),
    },
    async (args) => run((d) => listChats(d, args)),
  );

  return server;
}
