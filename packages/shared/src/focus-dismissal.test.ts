import { describe, expect, it } from "vitest";
import { matchDismissedFocusItem } from "./index";

const linkCandidate = {
  entityRef: { entityType: "link", entityId: "link_1" } as const,
  reason: "Saved article about Convex vector search tuning.",
  entityTitle: "Convex vector search deep dive",
};

const taskCandidate = {
  entityRef: { entityType: "task", entityId: "task_1" } as const,
  reason: "Chase statement email still needs a reply.",
  entityTitle: "Reply to Chase statement email",
};

describe("matchDismissedFocusItem", () => {
  it("matches a bullet to the topItem whose reason and title share its topic", () => {
    const match = matchDismissedFocusItem(
      "Reply to the Chase statement email and confirm the payment posted.",
      [linkCandidate, taskCandidate],
    );
    expect(match?.entityRef.entityId).toBe("task_1");
  });

  it("matches on the referenced entity title alone", () => {
    const match = matchDismissedFocusItem("Read the Convex vector search deep dive.", [
      { entityRef: { entityType: "link", entityId: "link_1" } as const, entityTitle: "Convex vector search deep dive" },
      taskCandidate,
    ]);
    expect(match?.entityRef.entityId).toBe("link_1");
  });

  it("skips silently when two candidates are about the same topic", () => {
    const match = matchDismissedFocusItem("Review the MCP server deployment checklist.", [
      {
        entityRef: { entityType: "link", entityId: "link_a" } as const,
        reason: "MCP server deployment checklist draft.",
        entityTitle: "MCP server deployment checklist",
      },
      {
        entityRef: { entityType: "note", entityId: "note_b" } as const,
        reason: "Notes from the MCP server deployment review.",
        entityTitle: "MCP server deployment notes",
      },
    ]);
    expect(match).toBeUndefined();
  });

  it("skips silently when overlap is too weak to be a clear winner", () => {
    const match = matchDismissedFocusItem("Schedule the dentist appointment for Friday.", [
      linkCandidate,
      taskCandidate,
    ]);
    expect(match).toBeUndefined();
  });

  it("skips silently when the bullet has no usable tokens", () => {
    expect(matchDismissedFocusItem("  --  ", [taskCandidate])).toBeUndefined();
    expect(matchDismissedFocusItem("Do it now.", [])).toBeUndefined();
  });
});
