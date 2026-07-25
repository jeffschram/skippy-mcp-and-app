import { describe, expect, it } from "vitest";
import {
  TASK_AREAS,
  TASK_COMMITMENTS,
  effectiveCommitment,
  normalizeAcceptedEntityPayload,
  taskDuplicateScopeMatches,
} from "./index";

describe("effectiveCommitment", () => {
  // Every task written before the life layer existed has no commitment, and
  // all of them are obligations. Absent must never read as "want", or old
  // tasks would silently vanish into a lane that never nags.
  it("treats an absent commitment as an obligation", () => {
    expect(effectiveCommitment({})).toBe("must");
    expect(effectiveCommitment({ commitment: undefined })).toBe("must");
    expect(effectiveCommitment({ commitment: null })).toBe("must");
  });

  it("preserves an explicit commitment", () => {
    expect(effectiveCommitment({ commitment: "must" })).toBe("must");
    expect(effectiveCommitment({ commitment: "want" })).toBe("want");
  });

  it("falls back to obligation for unrecognized values", () => {
    expect(effectiveCommitment({ commitment: "maybe" })).toBe("must");
  });
});

describe("taskDuplicateScopeMatches", () => {
  // The bug this guards: task duplicate detection matches on fuzzy title
  // similarity, so a life task "Call dentist" would merge into a project task
  // of the same name.
  it("refuses to merge a project-less task with a project task", () => {
    expect(taskDuplicateScopeMatches("project_1", undefined)).toBe(false);
    expect(taskDuplicateScopeMatches(undefined, "project_1")).toBe(false);
  });

  it("allows merging two project-less tasks", () => {
    expect(taskDuplicateScopeMatches(undefined, undefined)).toBe(true);
    expect(taskDuplicateScopeMatches(null, undefined)).toBe(true);
  });

  it("allows merging within the same project but not across projects", () => {
    expect(taskDuplicateScopeMatches("project_1", "project_1")).toBe(true);
    expect(taskDuplicateScopeMatches("project_1", "project_2")).toBe(false);
  });
});

describe("task payload normalization with life axes", () => {
  it("keeps area and commitment when recognized", () => {
    const normalized = normalizeAcceptedEntityPayload("task", {
      title: "Pick up dry cleaning",
      area: "errand",
      commitment: "must",
    });

    expect(normalized).toMatchObject({ area: "errand", commitment: "must" });
  });

  it("accepts lifeArea as an alias for area", () => {
    const normalized = normalizeAcceptedEntityPayload("task", {
      title: "Book a physical",
      lifeArea: "health",
    });

    expect(normalized).toMatchObject({ area: "health" });
  });

  it("drops unrecognized area and commitment values rather than storing them", () => {
    const normalized = normalizeAcceptedEntityPayload("task", {
      title: "Something",
      area: "gardening",
      commitment: "someday",
    }) as Record<string, unknown>;

    expect(normalized.area).toBeUndefined();
    expect(normalized.commitment).toBeUndefined();
  });

  it("normalizes a well-formed waitingOn reference", () => {
    const normalized = normalizeAcceptedEntityPayload("task", {
      title: "Quote from Dan",
      waitingOn: { entityType: "person", entityId: "person_123" },
      waitingSince: "2026-07-01T00:00:00.000Z",
    });

    expect(normalized).toMatchObject({
      waitingOn: { entityType: "person", entityId: "person_123" },
      waitingSince: Date.parse("2026-07-01T00:00:00.000Z"),
    });
  });

  it("drops a malformed waitingOn instead of rejecting the whole task", () => {
    const normalized = normalizeAcceptedEntityPayload("task", {
      title: "Quote from Dan",
      waitingOn: { entityType: "calendar_event", entityId: "evt_1" },
    }) as Record<string, unknown>;

    expect(normalized.title).toBe("Quote from Dan");
    expect(normalized.waitingOn).toBeUndefined();
  });

  it("leaves the life axes unset for callers that do not pass them", () => {
    const normalized = normalizeAcceptedEntityPayload("task", {
      title: "Untouched",
    }) as Record<string, unknown>;

    expect(normalized.area).toBeUndefined();
    expect(normalized.commitment).toBeUndefined();
    expect(normalized.waitingOn).toBeUndefined();
    expect(effectiveCommitment(normalized as { commitment?: string })).toBe("must");
  });
});

describe("life-layer taxonomies", () => {
  it("exposes the areas and commitments the schema mirrors", () => {
    expect(TASK_AREAS).toEqual([
      "work",
      "personal",
      "household",
      "health",
      "finance",
      "social",
      "errand",
    ]);
    expect(TASK_COMMITMENTS).toEqual(["must", "want"]);
  });
});
