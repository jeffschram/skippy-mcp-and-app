/**
 * Pure logic for the task detail panel (the chat-sidebar swap on the project
 * board). Kept free of React/Convex imports so it stays unit-testable.
 */

export type TaskDetailTask = {
  executionState?: string;
  status?: string;
  ownerType?: string;
  agentRequestStatus?: string;
  prUrl?: string;
  prNumber?: number;
  prStatus?: string;
};

// States where the task hasn't been executed yet — the brief is still editable.
export const PRE_EXECUTION_STATES = new Set([
  "proposed",
  "unplanned",
  "briefed",
  "ready",
  "blocked",
]);

// Mirrors the server rule: running or completed work records its result
// instead of being abandoned (see cancelTask in convex/projects.ts).
export const ABANDONABLE_STATES = new Set([
  "proposed",
  "unplanned",
  "briefed",
  "ready",
  "blocked",
]);

export function canEditBrief(task: TaskDetailTask): boolean {
  return PRE_EXECUTION_STATES.has(task.executionState ?? "unplanned");
}

export function canAbandon(task: TaskDetailTask): boolean {
  return ABANDONABLE_STATES.has(task.executionState ?? "unplanned");
}

export type PrimaryTaskAction =
  | { kind: "start_agent"; label: string }
  | { kind: "mark_in_progress"; label: string }
  | { kind: "mark_complete"; label: string }
  | null;

/**
 * The single most useful next step for a task, matching the Plan rows:
 * agent tasks start a workspace run, owner tasks toggle in-progress/complete.
 * Running agent work has no primary action — the workspace run owns its
 * lifecycle — and finished or abandoned tasks are read-only.
 */
export function primaryTaskAction(task: TaskDetailTask): PrimaryTaskAction {
  const state = task.executionState ?? "unplanned";
  if (state === "done" || state === "cancelled" || task.status === "done") {
    return null;
  }
  const running =
    state === "in_progress" ||
    state === "in_review" ||
    task.agentRequestStatus === "requested";
  if (task.ownerType === "agent") {
    return running ? null : { kind: "start_agent", label: "Start task" };
  }
  return running
    ? { kind: "mark_complete", label: "Mark complete" }
    : { kind: "mark_in_progress", label: "Mark in progress" };
}

/**
 * One criterion per line; leading list markers are tolerated so pasting a
 * Markdown checklist round-trips into clean criteria strings.
 */
export function parseCriteria(text: string): string[] {
  return text
    .split("\n")
    .map((line) =>
      line.replace(/^\s*(?:[-*•]\s*)?(?:\[[ x]\]\s*)?/i, "").trim(),
    )
    .filter(Boolean);
}

export function criteriaDraftFrom(criteria: string[] | undefined): string {
  return (criteria ?? []).join("\n");
}

/** Link label + raw status for the PR section; null when no PR is recorded. */
export function prDisplay(
  task: TaskDetailTask,
): { label: string; status?: string } | null {
  if (!task.prUrl) return null;
  return {
    label: task.prNumber ? `PR #${task.prNumber}` : "Open pull request",
    ...(task.prStatus ? { status: task.prStatus } : {}),
  };
}
