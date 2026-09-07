import { describe, expect, it } from "vitest";
import {
  candidateFingerprint,
  normalizeAcceptedEntityPayload,
  normalizeCandidateObject,
  normalizeConfidence,
  normalizeEntityInput,
  SOURCE_REF_DEDUPE_ENTITY_TYPES,
  sourceRefIdentityKey,
  sourceRefIdentityKeys,
  sourceRefKeysIntersect,
} from "./index";

describe("candidate object normalization", () => {
  it("trims required display fields", () => {
    expect(normalizeEntityInput("task", { title: "  Follow up  " })).toMatchObject({
      title: "Follow up",
    });
  });

  it("rejects blank required fields", () => {
    expect(() => normalizeEntityInput("note", { body: "   " })).toThrow("body is required");
  });

  it("normalizes confidence values", () => {
    expect(normalizeConfidence(0.75)).toBe(0.75);
    expect(() => normalizeConfidence(1.5)).toThrow("confidence must be a number between 0 and 1");
  });

  it("normalizes candidate payloads before MCP or Convex writes", () => {
    expect(
      normalizeCandidateObject({
        candidateEntityType: "company",
        candidatePayload: { name: "  Example Co  " },
        confidence: 0.4,
        reviewReason: "  Low confidence match  ",
      }),
    ).toMatchObject({
      candidateEntityType: "company",
      candidatePayload: { name: "Example Co" },
      confidence: 0.4,
      reviewReason: "Low confidence match",
    });
  });

  it("maps task-shaped harness payloads into accepted task schema fields", () => {
    expect(
      normalizeAcceptedEntityPayload("task", {
        title: "  Pay Optimum bill  ",
        dueDate: "2026-06-10",
        taskOwner: "owner",
        sourceSummary: "Email says the bill is ready.",
        start: "2026-06-09T14:00:00.000Z",
        end: "2026-06-09T15:00:00.000Z",
        amountDue: 82.5,
        unsupportedField: "ignored",
      }),
    ).toMatchObject({
      title: "Pay Optimum bill",
      status: "todo",
      ownerType: "owner",
      dueAt: Date.parse("2026-06-10"),
      description: expect.stringContaining("Email says the bill is ready."),
    });
  });

  it("maps contact aliases and drops unsupported fields for accepted people", () => {
    expect(
      normalizeAcceptedEntityPayload("person", {
        personName: "  Pat Example  ",
        email: " pat@example.com ",
        relationshipLabel: "client",
        sourceSummary: "Mentioned in a thread.",
        unexpected: true,
      }),
    ).toEqual({
      name: "Pat Example",
      emails: ["pat@example.com"],
      relationshipContext: "client",
    });
  });

  it("maps company aliases for accepted company records", () => {
    expect(
      normalizeAcceptedEntityPayload("company", {
        companyName: "  Example Co  ",
        url: "https://example.com",
        relationshipLabel: "vendor",
        sourceSummary: "Invoice sender.",
      }),
    ).toEqual({
      name: "Example Co",
      website: "https://example.com",
      notes: "Invoice sender.",
      relationshipLabel: "vendor",
    });
  });

  it("defaults ingested links to saved reference status", () => {
    expect(
      normalizeAcceptedEntityPayload("link", {
        url: "https://example.com/article",
        title: "Useful reference",
      }),
    ).toMatchObject({
      url: "https://example.com/article",
      status: "saved",
    });
  });

  it("passes explicit link statuses through unchanged", () => {
    expect(
      normalizeAcceptedEntityPayload("link", { url: "https://example.com/read-later", status: "unread" }),
    ).toMatchObject({ status: "unread" });
    expect(
      normalizeAcceptedEntityPayload("link", { url: "https://example.com/done", status: "read" }),
    ).toMatchObject({ status: "read" });
  });

  it("builds stable fingerprints from normalized accepted payloads", () => {
    expect(
      candidateFingerprint("task", {
        title: "  Fix schema mapping ",
        dueDate: "2026-06-10",
        unsupportedField: "ignored",
      }),
    ).toBe(
      candidateFingerprint("task", {
        title: "fix schema mapping",
        dueAt: Date.parse("2026-06-10"),
      }),
    );
  });
});

describe("source-ref identity dedupe", () => {
  it("keys the same message identically regardless of candidate wording", () => {
    // The 2026-09-07 Netlify incident: three passes, three titles, one email.
    const key = sourceRefIdentityKey({ sourceSystem: "gmail", messageId: "netlify-75pct-msg" });
    expect(key).toBe("gmail|message|netlify-75pct-msg");
    expect(sourceRefIdentityKey({ sourceSystem: " Gmail ", messageId: " netlify-75pct-msg " })).toBe(key);
  });

  it("prefers stronger identities over url and ignores threadId entirely", () => {
    expect(
      sourceRefIdentityKey({
        sourceSystem: "gmail",
        messageId: "msg-1",
        url: "https://mail.example.com/deep-link",
      }),
    ).toBe("gmail|message|msg-1");
    // threadId is not an identity: one thread may yield several distinct finds.
    expect(sourceRefIdentityKey({ sourceSystem: "gmail", threadId: "thread-1" } as never)).toBeNull();
    expect(sourceRefIdentityKey({ sourceSystem: "web", url: "https://example.com/a" })).toBe(
      "web|url|https://example.com/a",
    );
  });

  it("returns null for refs with no usable identity", () => {
    expect(sourceRefIdentityKey({ sourceSystem: "manual_conversation" })).toBeNull();
    expect(sourceRefIdentityKey(null)).toBeNull();
    expect(sourceRefIdentityKey({ sourceSystem: "gmail", messageId: "   " })).toBeNull();
  });

  it("collects keys across refs and detects intersections", () => {
    const incoming = sourceRefIdentityKeys([
      { sourceSystem: "gmail", messageId: "msg-1" },
      { sourceSystem: "manual_conversation" },
    ]);
    expect(incoming.size).toBe(1);
    const pending = sourceRefIdentityKeys([{ sourceSystem: "gmail", messageId: "msg-1" }]);
    const unrelated = sourceRefIdentityKeys([{ sourceSystem: "gmail", messageId: "msg-2" }]);
    expect(sourceRefKeysIntersect(incoming, pending)).toBe(true);
    expect(sourceRefKeysIntersect(incoming, unrelated)).toBe(false);
    expect(sourceRefKeysIntersect(incoming, new Set())).toBe(false);
  });

  it("scopes source-ref dedupe to the types with no other duplicate net", () => {
    expect(SOURCE_REF_DEDUPE_ENTITY_TYPES).toEqual(["note", "link", "knowledgeObject"]);
    expect(SOURCE_REF_DEDUPE_ENTITY_TYPES).not.toContain("task");
  });
});
