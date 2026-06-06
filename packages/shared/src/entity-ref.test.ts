import { describe, expect, it } from "vitest";
import { ENTITY_TYPES, isEntityType, makeEntityRef } from "./index";

describe("entity references", () => {
  it("recognizes every supported Skippy entity type", () => {
    expect(ENTITY_TYPES).toEqual([
      "goal",
      "project",
      "task",
      "note",
      "person",
      "company",
      "link",
      "knowledgeObject",
    ]);

    for (const entityType of ENTITY_TYPES) {
      expect(isEntityType(entityType)).toBe(true);
    }
  });

  it("rejects unknown entity types", () => {
    expect(isEntityType("email")).toBe(false);
    expect(isEntityType("calendar_event")).toBe(false);
    expect(isEntityType(42)).toBe(false);
  });

  it("builds a normalized entity ref for valid inputs", () => {
    expect(makeEntityRef("task", "task_123")).toEqual({
      entityType: "task",
      entityId: "task_123",
    });
  });

  it("throws for blank entity ids", () => {
    expect(() => makeEntityRef("task", "   ")).toThrow("entityId is required");
  });
});
