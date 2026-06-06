import { describe, expect, it } from "vitest";
import {
  GOAL_STATUSES,
  LINK_STATUSES,
  PROJECT_STATUSES,
  RELATIONSHIP_TYPES,
  TASK_STATUSES,
  isRelationshipType,
} from "./index";

describe("domain statuses and relationships", () => {
  it("defines core type-specific statuses from the development spec", () => {
    expect(GOAL_STATUSES).toEqual(["active", "paused", "achieved", "abandoned"]);
    expect(PROJECT_STATUSES).toEqual([
      "idea",
      "planned",
      "in_progress",
      "paused",
      "completed",
      "cancelled",
    ]);
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "waiting", "done", "cancelled"]);
    expect(LINK_STATUSES).toEqual(["unread", "read", "saved", "discarded"]);
  });

  it("defines the relationship graph vocabulary", () => {
    expect(RELATIONSHIP_TYPES).toContain("blocked_by");
    expect(RELATIONSHIP_TYPES).toContain("follow_up_with");
    expect(isRelationshipType("supports")).toBe(true);
    expect(isRelationshipType("tagged")).toBe(false);
  });
});
