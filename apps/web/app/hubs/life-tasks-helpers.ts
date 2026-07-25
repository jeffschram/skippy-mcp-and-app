import { TASK_AREAS, type TaskArea } from "@skippy/shared";

/* ------------------------------------------------------------------ */
/* Lane bucketing for the /tasks surface                               */
/*                                                                     */
/* Three lanes, and the split is deliberate:                           */
/*                                                                     */
/*   Due     — obligations with a deadline. This lane nags.            */
/*   Anytime — obligations with no deadline.                           */
/*   Wants   — things the owner would enjoy. No dates, no overdue, no  */
/*             counts. If wants can go red, the list becomes another   */
/*             source of guilt and stops being opened.                 */
/* ------------------------------------------------------------------ */

export type LifeTask = {
  _id: string;
  title: string;
  description?: string;
  status: string;
  area?: string;
  commitment: string;
  dueAt?: number;
  waitingOn?: { entityType: string; entityId: string };
  waitingSince?: number;
  lastNudgedAt?: number;
  recurrenceId?: string;
  updatedAt?: number;
};

export type LifeTaskLane = "due" | "anytime" | "wants";

export type LifeTaskLanes = {
  due: LifeTask[];
  anytime: LifeTask[];
  wants: LifeTask[];
  waiting: LifeTask[];
};

export const LANE_LABELS: Record<LifeTaskLane, string> = {
  due: "Due",
  anytime: "Anytime",
  wants: "Wants",
};

export const AREA_LABELS: Record<TaskArea, string> = {
  work: "Work",
  personal: "Personal",
  household: "Household",
  health: "Health",
  finance: "Finance",
  social: "Social",
  errand: "Errand",
};

export function areaLabel(area: string | undefined): string {
  return area && (TASK_AREAS as readonly string[]).includes(area)
    ? AREA_LABELS[area as TaskArea]
    : "Unsorted";
}

export function laneFor(task: LifeTask): LifeTaskLane {
  if (task.commitment === "want") return "wants";
  return typeof task.dueAt === "number" ? "due" : "anytime";
}

export function isOverdue(task: LifeTask, now: number): boolean {
  // Wants can never be overdue — that is the entire point of the lane.
  if (task.commitment === "want") return false;
  return typeof task.dueAt === "number" && task.dueAt < now;
}

/**
 * Splits tasks into lanes.
 *
 * Waiting tasks are pulled into their own list rather than sitting in Due,
 * because "blocked on someone else" is a different kind of item from "I need to
 * do this" and mixing them makes the Due lane read as longer than it is.
 */
export function bucketLifeTasks(tasks: LifeTask[] | undefined): LifeTaskLanes {
  const lanes: LifeTaskLanes = { due: [], anytime: [], wants: [], waiting: [] };

  for (const task of tasks ?? []) {
    if (task.status === "done" || task.status === "cancelled") continue;

    if (task.status === "waiting") {
      lanes.waiting.push(task);
      continue;
    }

    lanes[laneFor(task)].push(task);
  }

  lanes.due.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  lanes.anytime.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  lanes.wants.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  // Oldest unanswered thing first — that is the one most likely to need a nudge.
  lanes.waiting.sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0));

  return lanes;
}

/** Distinct areas present in a set of tasks, for the filter chips. */
export function areasPresent(tasks: LifeTask[] | undefined): string[] {
  const seen = new Set<string>();
  for (const task of tasks ?? []) {
    if (task.status === "done" || task.status === "cancelled") continue;
    seen.add(task.area ?? "unsorted");
  }

  const ordered = TASK_AREAS.filter((area) => seen.has(area)) as string[];
  return seen.has("unsorted") ? [...ordered, "unsorted"] : ordered;
}

export function filterByArea(tasks: LifeTask[], area: string | null): LifeTask[] {
  if (!area) return tasks;
  return tasks.filter((task) => (task.area ?? "unsorted") === area);
}

/** How long something has been waiting, in whole days. */
export function waitingDays(task: LifeTask, now: number): number | undefined {
  if (typeof task.waitingSince !== "number") return undefined;
  return Math.max(0, Math.floor((now - task.waitingSince) / (24 * 60 * 60 * 1000)));
}
