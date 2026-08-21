import { describe, expect, it } from "vitest";
import {
  completedPhaseSummary,
  phaseCompletion,
  type PhaseTask,
} from "./project-plan-helpers";

const done: PhaseTask = { executionState: "done" };
const cancelled: PhaseTask = { executionState: "cancelled" };
const open: PhaseTask = { executionState: "ready" };

describe("phaseCompletion", () => {
  it("is complete when every task is done", () => {
    expect(phaseCompletion([done, done, done])).toBe("complete");
  });

  it("is complete for a done + cancelled mix", () => {
    expect(phaseCompletion([done, cancelled, done])).toBe("complete");
  });

  it("treats zero tasks as empty, not complete", () => {
    expect(phaseCompletion([])).toBe("empty");
  });

  it("stays active while any task is open", () => {
    expect(phaseCompletion([done, done, open])).toBe("active");
    expect(phaseCompletion([open])).toBe("active");
  });

  it("re-activates a completed phase when a task reopens", () => {
    expect(phaseCompletion([done, done])).toBe("complete");
    expect(phaseCompletion([done, { executionState: "in_progress" }])).toBe(
      "active",
    );
  });

  it("does not call an all-cancelled phase complete", () => {
    expect(phaseCompletion([cancelled, cancelled])).toBe("active");
  });

  it("honors status as well as executionState", () => {
    expect(phaseCompletion([{ status: "done" }, { status: "cancelled" }])).toBe(
      "complete",
    );
    expect(phaseCompletion([{ status: "todo" }])).toBe("active");
  });

  it("treats a task with no lifecycle fields as open", () => {
    expect(phaseCompletion([done, {}])).toBe("active");
  });
});

describe("completedPhaseSummary", () => {
  it("pluralizes the task count", () => {
    expect(completedPhaseSummary(8)).toBe("8 tasks · completed");
    expect(completedPhaseSummary(1)).toBe("1 task · completed");
  });
});
