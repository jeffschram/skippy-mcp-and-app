import { describe, expect, it } from "vitest";
import {
  candidateFingerprint,
  normalizeAcceptedEntityPayload,
  normalizeCandidateObject,
  normalizeConfidence,
  normalizeEntityInput,
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
