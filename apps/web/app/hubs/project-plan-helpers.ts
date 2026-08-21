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
