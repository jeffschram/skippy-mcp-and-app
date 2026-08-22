/**
 * Task lifecycle notices for the chat timeline.
 *
 * Chat is the notification surface: each lifecycle event (task created/
 * briefed, run started, in review, completed) becomes one compact moment —
 * "something is happening with this task" — rendered at chat scale. Live run
 * narration deliberately does NOT live here; the task detail panel streams
 * that (see TaskRunActivity in app/hubs/task-detail.tsx).
 */

type AnyRecord = Record<string, any>;

export type TaskMomentState =
  | "created"
  | "in_progress"
  | "in_review"
  | "completed";

export type TaskMomentRecord = {
  key: string;
  timestamp: number;
  state: TaskMomentState;
  task: AnyRecord;
};

function isDone(task: AnyRecord): boolean {
  return task.executionState === "done" || task.status === "done";
}

/** One moment per lifecycle event a task has actually reached, per task. */
export function buildTaskMoments(tasks: AnyRecord[]): TaskMomentRecord[] {
  const moments: TaskMomentRecord[] = [];
  for (const task of tasks) {
    if (task.createdAt) {
      moments.push({
        key: `task:${task._id}:created`,
        timestamp: Number(task.createdAt),
        state: "created",
        task,
      });
    }
    // Prefer real start markers; only fall back to updatedAt while the task
    // is actively in_progress (an in_review task's updatedAt is its review
    // hand-off time, not its start).
    const startedAt =
      task.agentRequestedAt ??
      task.startedAt ??
      (task.executionState === "in_progress" ? task.updatedAt : undefined);
    if (startedAt) {
      moments.push({
        key: `task:${task._id}:started`,
        timestamp: Number(startedAt),
        state: "in_progress",
        task,
      });
    }
    if (task.executionState === "in_review") {
      moments.push({
        key: `task:${task._id}:in_review`,
        timestamp: Number(task.resultRecordedAt ?? task.updatedAt),
        state: "in_review",
        task,
      });
    }
    if (isDone(task)) {
      moments.push({
        key: `task:${task._id}:completed`,
        timestamp: Number(task.completedAt ?? task.updatedAt),
        state: "completed",
        task,
      });
    }
  }
  return moments;
}
