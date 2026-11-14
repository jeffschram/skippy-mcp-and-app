import { describe, expect, it } from "vitest";
import { messageIdentities } from "./message-identity-helpers.js";
const base = {
  source: "imessage:local:all", chatGuid: "chat-1", windowStart: Date.parse("2026-01-01T00:00:00Z"), windowEnd: Date.parse("2026-01-02T00:00:00Z"),
  senders: [{ local_ref: "s1", handle: "+15555550123" }],
  messages: [{ date: "2026-01-01T10:00:00.123456Z", sender: "s1", body: "Meeting at noon", attachments: [{ id: "b" }, { id: "a" }] }],
};
const id = (input = base) => messageIdentities(input).items[0]!.externalId;
describe("derived Messages identity", () => {
  it("survives local-reference changes, attachment ordering and equivalent date formatting", () => {
    expect(id({ ...base, senders: [{ local_ref: "s99", handle: "+15555550123" }], messages: [{ ...base.messages[0]!, sender: "s99", date: "2026-01-01T05:00:00.123456000-05:00", attachments: [{ id: "a" }, { id: "b" }] }] })).toBe(id());
  });
  it("separates scope, chat, sender, content, attachment and sub-millisecond timestamps", () => {
    const first = id();
    expect(id({ ...base, source: "imessage:other:all" })).not.toBe(first);
    expect(id({ ...base, chatGuid: "chat-2" })).not.toBe(first);
    for (const change of [{ sender: "me" }, { body: "Changed" }, { attachments: [] }, { date: "2026-01-01T10:00:00.123457Z" }]) {
      expect(id({ ...base, messages: [{ ...base.messages[0]!, ...change }] })).not.toBe(first);
    }
  });
  it("marks identical records ambiguous instead of inventing occurrence numbers", () => {
    expect(messageIdentities({ ...base, messages: [base.messages[0]!, base.messages[0]!] }).complete).toBe(false);
    expect(messageIdentities(base).complete).toBe(true);
  });
  it("rejects unknown mappings, missing content, bad dates and future windows", () => {
    for (const change of [{ sender: "unknown" }, { sender: "unmapped" }, { date: "bad" }, { body: undefined, attachments: [] }]) {
      expect(() => messageIdentities({ ...base, messages: [{ ...base.messages[0]!, ...change }] })).toThrow();
    }
    expect(() => messageIdentities({ ...base, windowEnd: Date.now() + 60000 })).toThrow();
  });
  it("uses inclusive start and exclusive end without returning raw content or handles", () => {
    const result = messageIdentities({ ...base, messages: [
      { ...base.messages[0]!, date: "2026-01-01T00:00:00Z" },
      { ...base.messages[0]!, date: "2026-01-02T00:00:00Z" },
    ] });
    expect(result.items.map(item => item.inWindow)).toEqual([true, false]);
    expect(JSON.stringify(result)).not.toContain("Meeting");
    expect(JSON.stringify(result)).not.toContain("1555555");
    expect(result.items[0]).not.toHaveProperty("messageId");
  });
});
