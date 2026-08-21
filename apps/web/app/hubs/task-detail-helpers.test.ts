import { describe, expect, it } from "vitest";
import {
  canAbandon,
  canConfirmCloseout,
  canEditBrief,
  criteriaDraftFrom,
  parseCriteria,
  prDisplay,
  primaryTaskAction,
  truncateMiddle,
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

describe("canConfirmCloseout", () => {
  it("offers close-out for an in_review task with a PR", () => {
    expect(
      canConfirmCloseout(task({ executionState: "in_review", prUrl: "https://github.com/x/y/pull/7" })),
    ).toBe(true);
  });

  it("does not require the stored prStatus to be merged (it lags GitHub)", () => {
    expect(
      canConfirmCloseout(
        task({ executionState: "in_review", prUrl: "https://github.com/x/y/pull/7", prStatus: "open" }),
      ),
    ).toBe(true);
  });

  it("requires a recorded PR", () => {
    expect(canConfirmCloseout(task({ executionState: "in_review" }))).toBe(false);
  });

  it("only applies to in_review tasks", () => {
    for (const state of ["ready", "in_progress", "done", "cancelled"]) {
      expect(
        canConfirmCloseout(task({ executionState: state, prUrl: "https://github.com/x/y/pull/7" })),
      ).toBe(false);
    }
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

describe("truncateMiddle", () => {
  it("leaves short text untouched", () => {
    expect(truncateMiddle("agent/task-fix", 28)).toBe("agent/task-fix");
  });

  it("keeps head and tail around a middle ellipsis at the max length", () => {
    const branch = "agent/task-ph8cwyem-skippy-mcp-and-app";
    const out = truncateMiddle(branch, 28);
    expect(out.length).toBe(28);
    expect(out).toContain("…");
    expect(out.startsWith("agent/task-ph8")).toBe(true);
    expect(out.endsWith("-mcp-and-app")).toBe(true);
  });

  it("returns exactly-max text unchanged", () => {
    const text = "x".repeat(28);
    expect(truncateMiddle(text, 28)).toBe(text);
  });

  it("ignores degenerate max values", () => {
    expect(truncateMiddle("abcdef", 1)).toBe("abcdef");
  });
});
