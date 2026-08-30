// Read-only access to the local iMessage archive (~/Library/Messages/chat.db).
// See docs/imessage-source.md for the security posture: the database is opened
// with SQLite's readOnly flag and this package contains zero send/AppleScript
// code — read-only by construction, same trust model as the audited Gmail and
// Calendar servers (docs/google-source.md).
//
// Uses node:sqlite (node >= 22.5) so there is no native-module build step.
// The experimental warning it prints goes to stderr only, which is harmless
// for a stdio MCP server (the protocol runs on stdout).

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeAttributedBody } from "./decode.js";

// Milliseconds between the Unix epoch and Apple's 2001-01-01 reference date.
export const APPLE_EPOCH_MS = 978307200000;

// message.date is nanoseconds since 2001-01-01 on modern macOS, but plain
// seconds on pre-High-Sierra rows. 1e12 cleanly separates the two ranges
// (seconds stay < ~1e9 for centuries; nanoseconds are >= ~5e17). Normalizing
// to REAL seconds in SQL also keeps values inside Number.MAX_SAFE_INTEGER —
// raw nanosecond INTEGERs would overflow a JS number.
const NORMALIZED_DATE_SECONDS =
  "CASE WHEN m.date > 1000000000000 THEN m.date / 1000000000.0 ELSE CAST(m.date AS REAL) END";

const MAX_LIMIT = 200;

export interface ImessageMessage {
  guid: string | null;
  date: string | null;
  fromMe: boolean;
  sender: string | null;
  chatIdentifier: string | null;
  chatName: string | null;
  service: string | null;
  text: string | null;
}

export interface ImessageChat {
  chatIdentifier: string | null;
  chatName: string | null;
  service: string | null;
  participants: string | null;
  messageCount: number;
  lastMessageAt: string | null;
}

export function defaultDbPath(): string {
  return join(homedir(), "Library", "Messages", "chat.db");
}

export function openMessagesDb(path: string = defaultDbPath()): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

// macOS TCC gates chat.db regardless of unix permissions; SQLite surfaces the
// denial as "authorization denied" (SQLITE_AUTH) or, depending on how the
// process is sandboxed, "unable to open database file" (SQLITE_CANTOPEN).
// Either way the fix is the same, so translate both into it.
export function describeDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/authorization denied|SQLITE_AUTH|unable to open database/i.test(message)) {
    return (
      `${message} — macOS blocked access to chat.db (TCC). Grant Full Disk Access to the ` +
      `binary that launches this MCP server, then retry (see docs/imessage-source.md).`
    );
  }
  return message;
}

const MESSAGE_SELECT = `
  SELECT
    m.guid AS guid,
    ${NORMALIZED_DATE_SECONDS} AS dateSeconds,
    m.is_from_me AS isFromMe,
    m.text AS text,
    m.attributedBody AS attributedBody,
    m.service AS service,
    h.id AS senderId,
    c.chat_identifier AS chatIdentifier,
    c.display_name AS chatName
  FROM message m
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  LEFT JOIN chat c ON c.ROWID = cmj.chat_id
`;

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function sinceToAppleSeconds(sinceIso: string): number {
  const ms = Date.parse(sinceIso);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid "since" timestamp: ${sinceIso} (expected ISO 8601)`);
  }
  return (ms - APPLE_EPOCH_MS) / 1000;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toMessage(row: Record<string, unknown>): ImessageMessage {
  const dateSeconds = typeof row.dateSeconds === "number" ? row.dateSeconds : null;
  const fromMe = row.isFromMe === 1 || row.isFromMe === 1n;
  const body = row.attributedBody instanceof Uint8Array ? row.attributedBody : null;
  return {
    guid: asString(row.guid),
    date:
      dateSeconds !== null && dateSeconds > 0
        ? new Date(APPLE_EPOCH_MS + dateSeconds * 1000).toISOString()
        : null,
    fromMe,
    sender: fromMe ? "me" : asString(row.senderId),
    chatIdentifier: asString(row.chatIdentifier),
    chatName: asString(row.chatName),
    service: asString(row.service),
    text: asString(row.text) ?? decodeAttributedBody(body),
  };
}

export interface RecentMessagesOptions {
  since?: string | undefined;
  limit?: number | undefined;
}

export function listRecentMessages(
  db: DatabaseSync,
  options: RecentMessagesOptions = {},
): ImessageMessage[] {
  const limit = clampLimit(options.limit, 50);
  const params: Array<string | number> = [];
  let where = "";
  if (options.since !== undefined) {
    where = `WHERE ${NORMALIZED_DATE_SECONDS} >= ?`;
    params.push(sinceToAppleSeconds(options.since));
  }
  const rows = db
    .prepare(`${MESSAGE_SELECT} ${where} ORDER BY m.date DESC LIMIT ?`)
    .all(...params, limit);
  return rows.map((row) => toMessage(row as Record<string, unknown>));
}

export interface SearchMessagesOptions {
  query: string;
  since?: string | undefined;
  limit?: number | undefined;
}

export function searchMessages(db: DatabaseSync, options: SearchMessagesOptions): ImessageMessage[] {
  const limit = clampLimit(options.limit, 50);
  // LIKE (case-insensitive for ASCII) covers rows with a text column;
  // instr() on the raw blob covers typedstream-only rows — the UTF-8 payload
  // bytes are embedded verbatim, so a byte search finds them (case-sensitive).
  const escaped = options.query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const clauses = [
    `(m.text LIKE ? ESCAPE '\\' OR (m.text IS NULL AND m.attributedBody IS NOT NULL AND instr(m.attributedBody, ?) > 0))`,
  ];
  const params: Array<string | number | Uint8Array> = [
    `%${escaped}%`,
    new TextEncoder().encode(options.query),
  ];
  if (options.since !== undefined) {
    clauses.push(`${NORMALIZED_DATE_SECONDS} >= ?`);
    params.push(sinceToAppleSeconds(options.since));
  }
  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY m.date DESC LIMIT ?`)
    .all(...params, limit);
  return rows.map((row) => toMessage(row as Record<string, unknown>));
}

export interface ThreadOptions {
  chatIdentifier: string;
  since?: string | undefined;
  limit?: number | undefined;
}

export function getThread(db: DatabaseSync, options: ThreadOptions): ImessageMessage[] {
  const limit = clampLimit(options.limit, 100);
  const clauses = ["c.chat_identifier = ?"];
  const params: Array<string | number> = [options.chatIdentifier];
  if (options.since !== undefined) {
    clauses.push(`${NORMALIZED_DATE_SECONDS} >= ?`);
    params.push(sinceToAppleSeconds(options.since));
  }
  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY m.date DESC LIMIT ?`)
    .all(...params, limit);
  // Newest-first LIMIT keeps the window recent; reverse for chronological reading.
  return rows.map((row) => toMessage(row as Record<string, unknown>)).reverse();
}

export interface ListChatsOptions {
  limit?: number | undefined;
}

export function listChats(db: DatabaseSync, options: ListChatsOptions = {}): ImessageChat[] {
  const limit = clampLimit(options.limit, 30);
  const rows = db
    .prepare(
      `
      SELECT
        c.chat_identifier AS chatIdentifier,
        c.display_name AS chatName,
        c.service_name AS service,
        MAX(${NORMALIZED_DATE_SECONDS}) AS lastSeconds,
        COUNT(m.ROWID) AS messageCount,
        (
          SELECT group_concat(h2.id, ', ')
          FROM chat_handle_join chj
          JOIN handle h2 ON h2.ROWID = chj.handle_id
          WHERE chj.chat_id = c.ROWID
        ) AS participants
      FROM chat c
      LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
      LEFT JOIN message m ON m.ROWID = cmj.message_id
      GROUP BY c.ROWID
      ORDER BY lastSeconds DESC
      LIMIT ?
      `,
    )
    .all(limit);
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const lastSeconds = typeof row.lastSeconds === "number" ? row.lastSeconds : null;
    return {
      chatIdentifier: asString(row.chatIdentifier),
      chatName: asString(row.chatName),
      service: asString(row.service),
      participants: asString(row.participants),
      messageCount: typeof row.messageCount === "number" ? row.messageCount : 0,
      lastMessageAt:
        lastSeconds !== null && lastSeconds > 0
          ? new Date(APPLE_EPOCH_MS + lastSeconds * 1000).toISOString()
          : null,
    };
  });
}
