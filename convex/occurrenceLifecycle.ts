import { computeNextDue, nextCalendarOccurrence, parseRRule } from "@skippy/shared";
import { completedTaskAttention } from "./attentionModel";
import { advanceDependentsAfterDone } from "./taskExecution";

export const isTerminal = (task: any) => task.status === "done" || task.status === "cancelled";
export function validDate(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) throw new Error("Invalid date");
}
export function validRule(rule: any) {
  if (rule.kind === "interval") {
    if (!Number.isSafeInteger(rule.everyDays) || rule.everyDays < 1 || rule.everyDays > 36500) throw new Error("Interval must be 1–36500 whole days");
  } else parseRRule(rule.rrule);
}
export async function taskRecurrence(db: any, brain: any, task: any) {
  const linked = await db.query("recurrences").withIndex("by_brain_current_task", (q: any) =>
    q.eq("brainInstanceId", brain).eq("currentTaskId", task._id)).first();
  return linked;
}
export async function finishTask(db: any, brain: any, task: any, outcome: "complete" | "skip", at: number, now: number) {
  if (task.brainInstanceId !== brain) throw new Error("Task unavailable");
  if (isTerminal(task)) return;
  await db.patch(task._id, { status: outcome === "complete" ? "done" : "cancelled",
    executionState: outcome === "complete" ? "done" : "cancelled", completedAt: outcome === "complete" ? at : undefined,
    attention: completedTaskAttention(task.attention, now), waitingOn: undefined, waitingSince: undefined,
    lastNudgedAt: undefined, updatedAt: now });
  if (outcome === "complete") await advanceDependentsAfterDone(db, brain, task._id, now);
}
export async function transitionOccurrence(db: any, brain: any, args: {
  recurrenceId: any; expectedOccurrenceVersion: number; requestId: string; action: "complete" | "skip"; completedAt?: number; note?: string;
}) {
  const recurrence = await db.get(args.recurrenceId);
  if (!recurrence || recurrence.brainInstanceId !== brain) throw new Error("Recurrence unavailable");
  if (!args.requestId.trim() || args.requestId.length > 200) throw new Error("Invalid request ID");
  const prior = await db.query("occurrenceActions").withIndex("by_brain_request", (q: any) =>
    q.eq("brainInstanceId", brain).eq("requestId", args.requestId)).first();
  if (prior) {
    if (prior.recurrenceId !== args.recurrenceId || prior.action !== args.action || prior.version !== args.expectedOccurrenceVersion) throw new Error("Request ID already used");
    return prior.result;
  }
  if (!Number.isSafeInteger(args.expectedOccurrenceVersion) || args.expectedOccurrenceVersion !== (recurrence.occurrenceVersion ?? 0)) throw new Error("This occurrence changed. Refresh and try again.");
  if (recurrence.status === "retired") throw new Error("This repeat is retired");
  const now = Date.now();
  const at = args.completedAt ?? now;
  validDate(at);
  if (at > now) throw new Error("Completion cannot be in the future");
  const nextDueAt = computeNextDue({ ...recurrence, ...(args.action === "skip" ? { anchor: "schedule" } : {}) }, at, now);
  validDate(nextDueAt);
  const task = recurrence.currentTaskId ? await db.get(recurrence.currentTaskId) : null;
  if (task && task.brainInstanceId !== brain) throw new Error("Linked task unavailable");
  if (task && !isTerminal(task)) {
    await db.patch(task._id, { recurrenceId: recurrence._id, occurrenceVersion: args.expectedOccurrenceVersion });
    await finishTask(db, brain, task, args.action, at, now);
  }
  const entry = { outcome: args.action === "complete" ? "completed" : "skipped", occurredAt: args.action === "complete" ? at : now,
    scheduledFor: recurrence.nextDueAt, ...(args.action === "complete" ? { completedAt: at } : {}),
    ...(task ? { taskId: task._id } : {}), ...(args.note ? { note: args.note } : {}) };
  await db.patch(recurrence._id, { nextDueAt, currentTaskId: undefined, occurrenceVersion: args.expectedOccurrenceVersion + 1,
    ...(args.action === "complete" ? { lastCompletedAt: at } : {}), history: [...(recurrence.history ?? []), entry].slice(-24), updatedAt: now });
  await db.insert("activityEvents", { brainInstanceId: brain, activityType: args.action === "complete" ? "recurrence_completed" : "recurrence_skipped",
    actorType: "user", timestamp: now, summary: `${args.action === "complete" ? "Completed" : "Skipped"} "${recurrence.title}".`,
    metadata: { recurrenceId: recurrence._id, scheduledFor: recurrence.nextDueAt, nextDueAt } });
  const result = { recurrenceId: recurrence._id, nextDueAt, completedAt: args.action === "complete" ? at : null };
  await db.insert("occurrenceActions", { brainInstanceId: brain, recurrenceId: recurrence._id, requestId: args.requestId,
    version: args.expectedOccurrenceVersion, action: args.action, result });
  return result;
}
export async function transitionTask(db: any, brain: any, task: any, action: "complete" | "skip") {
  if (isTerminal(task)) {
    if (task.status !== (action === "complete" ? "done" : "cancelled")) throw new Error("Task is already closed with a different outcome");
    return;
  }
  const recurrence = await taskRecurrence(db, brain, task);
  if (recurrence) {
    await transitionOccurrence(db, brain, { recurrenceId: recurrence._id, expectedOccurrenceVersion: recurrence.occurrenceVersion ?? 0,
      requestId: `task:${task._id}:${action}`, action });
  } else {
    if (task.recurrenceId) throw new Error("This task no longer represents the current occurrence");
    await finishTask(db, brain, task, action, Date.now(), Date.now());
  }
}
export async function patchSchedule(db: any, brain: any, args: {
  recurrenceId: any; expectedOccurrenceVersion: number; rule?: any; anchor?: "completion" | "schedule"; timeZone?: string | undefined; nextDueAt?: number;
}) {
  const recurrence = await db.get(args.recurrenceId);
  if (!recurrence || recurrence.brainInstanceId !== brain) throw new Error("Recurrence unavailable");
  if (args.expectedOccurrenceVersion !== (recurrence.occurrenceVersion ?? 0)) throw new Error("This occurrence changed. Refresh and try again.");
  const rule = args.rule ?? recurrence.rule;
  validRule(rule);
  const timeZone = args.timeZone ?? recurrence.timeZone ?? "UTC";
  new Intl.DateTimeFormat("en", { timeZone }).format(0);
  const nextDueAt = args.nextDueAt ?? (rule.kind === "calendar" ? nextCalendarOccurrence(rule.rrule, recurrence.nextDueAt - 1, timeZone, recurrence.nextDueAt) : recurrence.nextDueAt);
  validDate(nextDueAt);
  const version = (recurrence.occurrenceVersion ?? 0) + 1;
  const task = recurrence.currentTaskId ? await db.get(recurrence.currentTaskId) : null;
  if (task && task.brainInstanceId !== brain) throw new Error("Linked task unavailable");
  if (task && !isTerminal(task)) await db.patch(task._id, { dueAt: nextDueAt, recurrenceId: recurrence._id, occurrenceVersion: version, updatedAt: Date.now() });
  await db.patch(recurrence._id, { rule, anchor: args.anchor ?? recurrence.anchor, timeZone, nextDueAt, occurrenceVersion: version,
    ...(!task || isTerminal(task) ? { currentTaskId: undefined } : {}), updatedAt: Date.now() });
  return { recurrenceId: recurrence._id, nextDueAt };
}
