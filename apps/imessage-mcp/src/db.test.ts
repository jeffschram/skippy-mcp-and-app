import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APPLE_EPOCH_MS,
  describeDbError,
  getThread,
  listChats,
  listRecentMessages,
  openMessagesDb,
  searchMessages,
} from "./db.js";

const encoder = new TextEncoder();

// Minimal typedstream blob (short-string form) — mirrors the builder in
// decode.test.ts; kept local because importing a test file would re-register
// its suites here.
function typedstreamBlob(text: string): Uint8Array {
  const utf8 = encoder.encode(text);
  if (utf8.length >= 128) throw new Error("fixture helper only supports short strings");
  const classes = encoder.encode("streamtyped NSAttributedString NSString");
  const tags = new Uint8Array([0x01, 0x94, 0x84, 0x01, 0x2b, utf8.length]);
  const out = new Uint8Array(classes.length + tags.length + utf8.length + 2);
  out.set(classes, 0);
  out.set(tags, classes.length);
  out.set(utf8, classes.length + tags.length);
  out.set([0x86, 0x84], classes.length + tags.length + utf8.length);
  return out;
}

// Modern rows store nanoseconds since 2001-01-01 as INTEGER; use BigInt so
// SQLite stores a true INTEGER (a JS number would become a REAL).
function appleNs(iso: string): bigint {
  return BigInt(Date.parse(iso) - APPLE_EPOCH_MS) * 1_000_000n;
}

let dir: string;
let dbPath: string;
let db: DatabaseSync;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "imessage-mcp-test-"));
  dbPath = join(dir, "chat.db");
  const fixture = new DatabaseSync(dbPath);
  fixture.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT, service_name TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      guid TEXT,
      text TEXT,
      attributedBody BLOB,
      handle_id INTEGER,
      date INTEGER,
      is_from_me INTEGER,
      service TEXT
    );
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
  `);

  fixture.exec(`
    INSERT INTO handle (ROWID, id) VALUES (1, '+15551234567'), (2, 'friend@example.com');
    INSERT INTO chat (ROWID, chat_identifier, display_name, service_name) VALUES
      (1, '+15551234567', NULL, 'iMessage'),
      (2, 'chat123456789', 'Family', 'iMessage');
    INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1), (2, 1), (2, 2);
  `);

  const insert = fixture.prepare(
    `INSERT INTO message (ROWID, guid, text, attributedBody, handle_id, date, is_from_me, service)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // m1/m2: 1:1 chat with plain text. m3: typedstream-only group message.
  // m4: legacy row storing seconds (pre-High-Sierra format). m5: escape-test text.
  insert.run(1, "g1", "Dinner tomorrow at 7?", null, 1, appleNs("2026-08-29T22:00:00Z"), 0, "iMessage");
  insert.run(2, "g2", "Sounds good", null, 0, appleNs("2026-08-29T22:05:00Z"), 1, "iMessage");
  insert.run(
    3,
    "g3",
    null,
    typedstreamBlob("Don't forget the 50% off coupon"),
    2,
    appleNs("2026-08-30T01:00:00Z"),
    0,
    "iMessage",
  );
  insert.run(4, "g4", "old sms", null, 1, 448329600n, 0, "SMS"); // seconds: 2015-03-18T00:00:00Z
  insert.run(5, "g5", "I am 100% sure", null, 0, appleNs("2026-08-30T02:00:00Z"), 1, "iMessage");
  fixture.exec(`
    INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, 1), (1, 2), (2, 3), (1, 4), (2, 5);
  `);
  fixture.close();

  db = openMessagesDb(dbPath);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openMessagesDb", () => {
  it("opens read-only: writes are rejected", () => {
    expect(() => db.exec("INSERT INTO handle (id) VALUES ('x')")).toThrow(/readonly|read-only/i);
  });
});

describe("listRecentMessages", () => {
  it("returns newest first with normalized dates and senders", () => {
    const messages = listRecentMessages(db);
    expect(messages.map((m) => m.guid)).toEqual(["g5", "g3", "g2", "g1", "g4"]);
    const [g5, g3] = messages;
    expect(g5?.date).toBe("2026-08-30T02:00:00.000Z");
    expect(g5?.fromMe).toBe(true);
    expect(g5?.sender).toBe("me");
    expect(g3?.sender).toBe("friend@example.com");
    expect(g3?.chatName).toBe("Family");
  });

  it("decodes typedstream-only rows into text", () => {
    const g3 = listRecentMessages(db).find((m) => m.guid === "g3");
    expect(g3?.text).toBe("Don't forget the 50% off coupon");
  });

  it("normalizes legacy seconds-format dates", () => {
    const g4 = listRecentMessages(db).find((m) => m.guid === "g4");
    expect(g4?.date).toBe("2015-03-18T00:00:00.000Z");
  });

  it("filters with since across both date formats", () => {
    const messages = listRecentMessages(db, { since: "2026-08-30T00:00:00Z" });
    expect(messages.map((m) => m.guid)).toEqual(["g5", "g3"]);
  });

  it("applies limit", () => {
    expect(listRecentMessages(db, { limit: 2 })).toHaveLength(2);
  });

  it("rejects a malformed since", () => {
    expect(() => listRecentMessages(db, { since: "not-a-date" })).toThrow(/Invalid "since"/);
  });
});

describe("searchMessages", () => {
  it("matches the text column case-insensitively", () => {
    const hits = searchMessages(db, { query: "dinner" });
    expect(hits.map((m) => m.guid)).toEqual(["g1"]);
  });

  it("matches typedstream-only rows via byte search", () => {
    const hits = searchMessages(db, { query: "50% off" });
    expect(hits.map((m) => m.guid)).toEqual(["g3"]);
  });

  it("escapes LIKE wildcards", () => {
    // Without escaping, "100%" would also match "10<anything>" patterns.
    const hits = searchMessages(db, { query: "100% sure" });
    expect(hits.map((m) => m.guid)).toEqual(["g5"]);
    expect(searchMessages(db, { query: "1_0" })).toHaveLength(0);
  });
});

describe("getThread", () => {
  it("returns a 1:1 conversation in chronological order", () => {
    const thread = getThread(db, { chatIdentifier: "+15551234567" });
    expect(thread.map((m) => m.guid)).toEqual(["g4", "g1", "g2"]);
  });

  it("returns a group chat by chatNNN identifier", () => {
    const thread = getThread(db, { chatIdentifier: "chat123456789" });
    expect(thread.map((m) => m.guid)).toEqual(["g3", "g5"]);
  });

  it("honors since + limit", () => {
    const thread = getThread(db, {
      chatIdentifier: "+15551234567",
      since: "2026-01-01T00:00:00Z",
      limit: 1,
    });
    expect(thread.map((m) => m.guid)).toEqual(["g2"]);
  });
});

describe("listChats", () => {
  it("orders by recent activity with participants and counts", () => {
    const chats = listChats(db);
    expect(chats.map((c) => c.chatIdentifier)).toEqual(["chat123456789", "+15551234567"]);
    const [family, direct] = chats;
    expect(family?.chatName).toBe("Family");
    expect(family?.participants).toBe("+15551234567, friend@example.com");
    expect(family?.messageCount).toBe(2);
    expect(family?.lastMessageAt).toBe("2026-08-30T02:00:00.000Z");
    expect(direct?.messageCount).toBe(3);
  });
});

describe("describeDbError", () => {
  it("adds Full Disk Access guidance for TCC denials", () => {
    const hint = describeDbError(new Error("unable to open database: authorization denied"));
    expect(hint).toMatch(/Full Disk Access/);
    expect(describeDbError(new Error("unable to open database file"))).toMatch(/Full Disk Access/);
  });

  it("passes through other errors unchanged", () => {
    expect(describeDbError(new Error("boom"))).toBe("boom");
  });
});
