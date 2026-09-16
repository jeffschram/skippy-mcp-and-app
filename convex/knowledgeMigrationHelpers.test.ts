import { describe, expect, it } from "vitest";
import { adoptionPatch, legacyKnowledgeDocument, legacyRowMatchesKnowledge, rewriteLegacyReferences } from "./knowledgeMigrationHelpers";

describe("legacy Knowledge migration", () => {
  it("preserves legacy metadata and terminal state without system or embedded relationship fields", () => {
    const row = { _id: "old", _creationTime: 1, relatedEntityRefs: [], status: "rejected", rejectedAt: 4, attention: { override: "normal" }, focusSnoozedUntil: 5, enrichmentStatus: "completed" };
    expect(legacyKnowledgeDocument("memory", row)).toEqual({ status: "rejected", rejectedAt: 4, attention: row.attention, focusSnoozedUntil: 5, enrichmentStatus: "completed", kind: "memory", legacyId: "old", processingState: "rejected" });
  });
  it("maps inbox memories to suggested", () => {
    expect(legacyKnowledgeDocument("memory", { _id: "old", status: "inbox" }).processingState).toBe("suggested");
  });
  it("adopts duplicate links without overwriting current edits and merges source IDs", () => {
    const current = { legacyId: "first", title: "Edited", status: "discarded", updatedAt: 10, sourceRefIds: ["new"] };
    const patch = adoptionPatch("link", { _id: "second", title: "Old", status: "unread", updatedAt: 2, sourceRefIds: ["old"], summary: "Recovered" }, current);
    expect({ ...current, ...patch }).toMatchObject({ title: "Edited", status: "discarded", updatedAt: 10, summary: "Recovered", legacyId: "first", legacyIds: ["first", "second"], sourceRefIds: ["new", "old"] });
    expect(adoptionPatch("link", { _id: "second" }, { ...current, ...patch }).legacyIds).toEqual(["first", "second"]);
  });
  it("does not equate different object properties", () => {
    expect(legacyRowMatchesKnowledge("knowledgeObject", { title: "X", objectType: "ref", properties: { a: 1 } }, { title: "X", objectType: "ref", properties: { a: 2 } })).toBe(false);
  });
  it("rewrites nested references idempotently without replacing text substrings", () => {
    const map = new Map([["old", "canonical"]]);
    const result = rewriteLegacyReferences({ refs: [{ entityId: "old" }], memoryId: "old", text: "the old record", other: "unmapped" }, map);
    expect(result).toEqual({ refs: [{ entityId: "canonical" }], memoryId: "canonical", text: "the old record", other: "unmapped" });
    expect(rewriteLegacyReferences(result, map)).toEqual(result);
  });
});
