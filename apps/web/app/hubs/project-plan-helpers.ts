/**
 * Pure logic for the project Plan view (project-board.tsx). Kept free of
 * React/Convex imports so it stays unit-testable.
 */

export type PhaseTask = {
  executionState?: string;
  status?: string;
};

export type PhaseCompletion = "empty" | "active" | "complete";

// Mirrors displayState in project-board.tsx: either lifecycle field can
// mark a task finished.
function isDone(task: PhaseTask): boolean {
  return task.executionState === "done" || task.status === "done";
}

// Terminal = no further work will happen on this task.
function isTerminal(task: PhaseTask): boolean {
  return (
    isDone(task) ||
    task.executionState === "cancelled" ||
    task.status === "cancelled"
  );
}

/**
 * How the Plan should treat a phase:
 * - "empty": zero tasks — probably still being set up, render as usual.
 * - "complete": real finished work — every task terminal (done/cancelled)
 *   and at least one actually done. Collapsible in the Plan. A phase of
 *   nothing but abandoned tasks is not "complete"; a green check over pure
 *   cancellations would misread.
 * - "active": anything else — an open task keeps the phase active, so
 *   reopening or adding a task automatically un-collapses a phase.
 */
export function phaseCompletion(tasks: PhaseTask[]): PhaseCompletion {
  if (tasks.length === 0) return "empty";
  if (tasks.every(isTerminal) && tasks.some(isDone)) return "complete";
  return "active";
}

/** Header summary for a collapsed completed phase, e.g. "8 tasks · completed". */
export function completedPhaseSummary(taskCount: number): string {
  return `${taskCount} ${taskCount === 1 ? "task" : "tasks"} · completed`;
}

/**
 * Split the Plan's phases into the ones rendered in place (active/empty,
 * original order preserved) and the fully-completed ones, which the Plan
 * consolidates into one collapsed "Completed phases" section at the bottom —
 * mirroring how completed tasks tuck under a details row inside a phase.
 * Generic over the phase shape so the UI can pass its own records; only the
 * tasks matter here.
 */
export function partitionPhasesByCompletion<Phase>(
  phases: Phase[],
  tasksForPhase: (phase: Phase) => PhaseTask[],
): { activePhases: Phase[]; completedPhases: Phase[] } {
  const activePhases: Phase[] = [];
  const completedPhases: Phase[] = [];
  for (const phase of phases) {
    if (phaseCompletion(tasksForPhase(phase)) === "complete") {
      completedPhases.push(phase);
    } else {
      activePhases.push(phase);
    }
  }
  return { activePhases, completedPhases };
}
