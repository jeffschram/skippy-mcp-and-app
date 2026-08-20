import { describe, expect, it } from "vitest";
import {
  canAbandon,
  canEditBrief,
  criteriaDraftFrom,
  parseCriteria,
  prDisplay,
  primaryTaskAction,
  type TaskDetailTask,
} from "./task-detail-helpers";

function task(overrides: TaskDetailTask = {}): TaskDetailTask {
  return { executionState: "ready", ownerType: "owner", ...overrides };
}

describe("canEditBrief", () => {
  it("allows editing before execution starts", () => {
    for (const state of ["proposed", "unplanned", "briefed", "ready", "blocked"]) {
      expect(canEditBrief(task({ executionState: state }))).toBe(true);
    }
  });

  it("locks the brief once work is running or finished", () => {
    for (const state of ["in_progress", "in_review", "done", "cancelled"]) {
      expect(canEditBrief(task({ executionState: state }))).toBe(false);
    }
  });

  it("treats a missing state as unplanned", () => {
    expect(canEditBrief({})).toBe(true);
  });
});

describe("canAbandon", () => {
  it("mirrors the server's abandonable states", () => {
    expect(canAbandon(task({ executionState: "briefed" }))).toBe(true);
    expect(canAbandon(task({ executionState: "in_progress" }))).toBe(false);
    expect(canAbandon(task({ executionState: "done" }))).toBe(false);
    expect(canAbandon(task({ executionState: "cancelled" }))).toBe(false);
  });
});

describe("primaryTaskAction", () => {
  it("offers start for idle agent tasks", () => {
    expect(primaryTaskAction(task({ ownerType: "agent" }))).toEqual({
      kind: "start_agent",
      label: "Start task",
    });
  });

  it("has no action while agent work runs or is queued", () => {
    expect(
      primaryTaskAction(task({ ownerType: "agent", executionState: "in_progress" })),
    ).toBeNull();
    expect(
      primaryTaskAction(
        task({ ownerType: "agent", agentRequestStatus: "requested" }),
      ),
    ).toBeNull();
  });

  it("toggles owner tasks between in-progress and complete", () => {
    expect(primaryTaskAction(task())).toEqual({
      kind: "mark_in_progress",
      label: "Mark in progress",
    });
    expect(primaryTaskAction(task({ executionState: "in_progress" }))).toEqual({
      kind: "mark_complete",
      label: "Mark complete",
    });
    expect(primaryTaskAction(task({ executionState: "in_review" }))).toEqual({
      kind: "mark_complete",
      label: "Mark complete",
    });
  });

  it("is read-only for finished or abandoned tasks", () => {
    expect(primaryTaskAction(task({ executionState: "done" }))).toBeNull();
    expect(primaryTaskAction(task({ executionState: "cancelled" }))).toBeNull();
    expect(primaryTaskAction(task({ status: "done" }))).toBeNull();
  });
});

describe("parseCriteria", () => {
  it("splits one criterion per line and drops blanks", () => {
    expect(parseCriteria("Tests pass\n\n  Feature renders  \n")).toEqual([
      "Tests pass",
      "Feature renders",
    ]);
  });

  it("strips Markdown list and checkbox markers", () => {
    expect(
      parseCriteria("- [ ] Tests pass\n* Feature renders\n• [x] Docs updated"),
    ).toEqual(["Tests pass", "Feature renders", "Docs updated"]);
  });

  it("round-trips through criteriaDraftFrom", () => {
    const criteria = ["Tests pass", "Feature renders"];
    expect(parseCriteria(criteriaDraftFrom(criteria))).toEqual(criteria);
    expect(criteriaDraftFrom(undefined)).toBe("");
  });
});

describe("prDisplay", () => {
  it("returns null without a PR url", () => {
    expect(prDisplay(task())).toBeNull();
  });

  it("labels with the PR number when known", () => {
    expect(
      prDisplay(task({ prUrl: "https://github.com/x/y/pull/7", prNumber: 7, prStatus: "open" })),
    ).toEqual({ label: "PR #7", status: "open" });
  });

  it("falls back to a generic label", () => {
    expect(prDisplay(task({ prUrl: "https://github.com/x/y/pull/7" }))).toEqual({
      label: "Open pull request",
    });
  });
});
