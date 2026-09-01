// Write-capable Google Calendar MCP server (docs/google-source.md).
//
// ONE tool: create_event. There is no list, update, patch, or delete anywhere
// in this package — reads stay with the audited read-only `gcal` server, so a
// compromised or confused agent holding this connector can add an event and
// nothing else. Keep it that way; adding a second tool changes the risk profile
// of the whole host and needs owner sign-off.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { TokenSource } from "./auth.js";
import { EventValidationError, type CreateEventInput } from "./event.js";
import { insertEvent } from "./google.js";

const instructions =
  "Creates events on the owner's Google Calendar. This server can ONLY create " +
  "events — it cannot list, read, update, or delete anything; use the read-only " +
  "`gcal` server for reads. Times are epoch milliseconds. Events land on the " +
  "owner's primary calendar unless calendarId says otherwise. Pass the Skippy " +
  "eventId from a staged calendar_event_create action so retries are idempotent " +
  "(a duplicate id returns `conflict`, which means the event already exists and " +
  "is a success, not an error).";

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function createGcalWriteMcpServer(tokens: TokenSource, fetchImpl: typeof fetch = fetch) {
  const server = new McpServer(
    { name: "gcal-write", version: "0.1.0" },
    { instructions },
  );

  server.registerTool(
    "create_event",
    {
      title: "Create a Google Calendar event",
      description:
        "Create one event on the owner's Google Calendar. Idempotent when eventId is supplied: " +
        "re-sending a known id returns status \"conflict\", meaning the event already exists.",
      annotations: {
        readOnlyHint: false,
        // Creating an event adds; it never overwrites or removes anything.
        destructiveHint: false,
        // Idempotent only via eventId, which is why the schema pushes for it.
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        summary: z.string().min(1).describe("Event title"),
        start: z.number().describe("Start time, epoch milliseconds"),
        end: z.number().describe("End time, epoch milliseconds; must be after start"),
        description: z.string().optional(),
        location: z.string().optional(),
        isAllDay: z
          .boolean()
          .optional()
          .describe("All-day event; start/end are read as dates and end is exclusive"),
        timeZone: z.string().optional().describe("IANA zone, e.g. America/Chicago"),
        calendarId: z
          .string()
          .optional()
          .describe("Defaults to 'primary' (the owner's own calendar)"),
        eventId: z
          .string()
          .optional()
          .describe(
            "Skippy-minted base32hex id from the staged action; supply it to make retries safe",
          ),
      }),
    },
    async (args) => {
      let accessToken: string;
      try {
        accessToken = await tokens.getAccessToken();
      } catch (error) {
        return toolError(
          `Google credentials unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        const outcome = await insertEvent(args as CreateEventInput, accessToken, fetchImpl);
        // A failed insert is reported as an MCP error so the caller cannot
        // mistake it for a created event, but the structured outcome still
        // travels so it can be forwarded to Convex verbatim.
        return outcome.status === "failed"
          ? toolError(JSON.stringify(outcome))
          : toolResult(outcome);
      } catch (error) {
        if (error instanceof EventValidationError) return toolError(error.message);
        return toolError(
          `Calendar insert failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  return server;
}
