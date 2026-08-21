import { describe, expect, it } from "vitest";
import {
  completedPhaseSummary,
  partitionPhasesByCompletion,
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

describe("partitionPhasesByCompletion", () => {
  type Phase = { id: string; tasks: PhaseTask[] };
  const tasksFor = (phase: Phase) => phase.tasks;
  const ids = (phases: Phase[]) => phases.map((phase) => phase.id);

  it("moves only fully-complete phases out, preserving both orders", () => {
    const phases: Phase[] = [
      { id: "a", tasks: [done, done] },
      { id: "b", tasks: [done, open] },
      { id: "c", tasks: [done, cancelled] },
      { id: "d", tasks: [open] },
    ];
    const { activePhases, completedPhases } = partitionPhasesByCompletion(
      phases,
      tasksFor,
    );
    expect(ids(activePhases)).toEqual(["b", "d"]);
    expect(ids(completedPhases)).toEqual(["a", "c"]);
  });

  it("keeps empty phases in place — being set up is not being finished", () => {
    const phases: Phase[] = [
      { id: "empty", tasks: [] },
      { id: "full", tasks: [done] },
    ];
    const { activePhases, completedPhases } = partitionPhasesByCompletion(
      phases,
      tasksFor,
    );
    expect(ids(activePhases)).toEqual(["empty"]);
    expect(ids(completedPhases)).toEqual(["full"]);
  });

  it("does not sink an all-cancelled phase", () => {
    const phases: Phase[] = [{ id: "x", tasks: [cancelled, cancelled] }];
    const { activePhases, completedPhases } = partitionPhasesByCompletion(
      phases,
      tasksFor,
    );
    expect(ids(activePhases)).toEqual(["x"]);
    expect(completedPhases).toEqual([]);
  });

  it("returns empty partitions for no phases", () => {
    expect(partitionPhasesByCompletion([], tasksFor)).toEqual({
      activePhases: [],
      completedPhases: [],
    });
  });
});
