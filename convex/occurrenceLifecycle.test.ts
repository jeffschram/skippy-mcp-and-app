import { describe, expect, it, vi } from "vitest";
import { transitionOccurrence, transitionTask, patchSchedule } from "./occurrenceLifecycle";
import { updateLifeTask, createLifeTask, setLifeTaskStatus } from "./lifeTasks";
import { setRecurrenceStatusForViewer } from "./recurrences";
import { setWaitingOn } from "./waiting";
vi.mock("./auth", () => ({ requireOwnedBrain: async () => ({ brain: { _id: "mine" } }) }));
const now = Date.parse("2026-03-09T12:00:00Z");
const due = Date.parse("2026-03-07T13:00:00Z");
const day = 86400000;
function fixture(extra: Record<string, any> = {}) {
  const records: Record<string, any> = {
    repeat: { _id: "repeat", brainInstanceId: "mine", rule: { kind: "interval", everyDays: 7 }, anchor: "completion", timeZone: "America/New_York", nextDueAt: due, status: "active", currentTaskId: "task", ...extra },
    task: { _id: "task", brainInstanceId: "mine", processingState: "accepted", title: "Filter", description: "Keep me", status: "waiting", dueAt: due, updatedAt: 1 },
    other: { _id: "other", brainInstanceId: "other" },
  };
  const db: any = {
    get: async (id: string) => records[id] ?? null,
    normalizeId: (_: string, id: string) => records[id] ? id : null,
    patch: async (id: string, patch: any) => { records[id] = { ...records[id], ...patch }; },
    insert: async (table: string, value: any) => { const id = `${table}:${Object.keys(records).length}`; records[id] = { _id: id, ...value }; return id; },
    query: (table: string) => {
      let rows = Object.values(records).filter(row => table === "recurrences" ? row._id === "repeat" : row._id.startsWith(`${table}:`));
      const chain: any = { filter: () => chain, withIndex: (_: string, cb: any) => { const q: any = { eq: (key: string, value: any) => { rows = rows.filter(row => row[key] === value); return q; } }; cb(q); return chain; }, first: async () => rows[0] ?? null, collect: async () => rows };
      return chain;
    },
  };
  return { db, records };
}
const run = (fn: any, db: any, args: any) => fn._handler({ db }, args);
const request = { recurrenceId: "repeat", expectedOccurrenceVersion: 0, requestId: "request", action: "complete" as const };
describe("atomic occurrence lifecycle", () => {
  it("completes once, preserves task identity and history, and replays the original result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { db, records } = fixture({ history: [{ completedAt: due - day }] });
    const result = await transitionOccurrence(db, "mine", request);
    expect(result.nextDueAt).toBe(Date.parse("2026-03-16T12:00:00Z"));
    expect(records.task).toMatchObject({ _id: "task", status: "done", recurrenceId: "repeat", occurrenceVersion: 0, description: "Keep me" });
    expect(records.repeat.history).toHaveLength(2);
    expect(records.repeat.history[1]).toMatchObject({ outcome: "completed", scheduledFor: due, taskId: "task" });
    expect(await transitionOccurrence(db, "mine", request)).toEqual(result);
    await expect(transitionOccurrence(db, "mine", { ...request, requestId: "stale" })).rejects.toThrow("changed");
    await transitionTask(db, "mine", records.task, "complete");
    expect(records.repeat.history).toHaveLength(2);
    vi.restoreAllMocks();
  });
  it("skips from the scheduled date for either anchor, retaining last completion across DST", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    for (const anchor of ["completion", "schedule"]) {
      const { db, records } = fixture({ anchor, lastCompletedAt: due - 7 * day });
      await transitionOccurrence(db, "mine", { ...request, action: "skip" });
      expect(records.repeat.nextDueAt).toBe(Date.parse("2026-03-14T12:00:00Z"));
      expect(records.repeat.lastCompletedAt).toBe(due - 7 * day);
      expect(records.repeat.history[0]).toMatchObject({ outcome: "skipped", occurredAt: now, scheduledFor: due });
      expect(records.repeat.history[0].completedAt).toBeUndefined();
      expect(records.task.status).toBe("cancelled");
    }
    vi.restoreAllMocks();
  });
  it("edits cadence and explicit next date while keeping the task and rejects old occurrence actions", async () => {
    const { db, records } = fixture();
    await patchSchedule(db, "mine", { recurrenceId: "repeat", expectedOccurrenceVersion: 0, rule: { kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" }, nextDueAt: now });
    expect(records.task).toMatchObject({ status: "waiting", description: "Keep me", dueAt: now, occurrenceVersion: 1 });
    expect(records.repeat).toMatchObject({ currentTaskId: "task", nextDueAt: now, occurrenceVersion: 1 });
    await expect(transitionOccurrence(db, "mine", request)).rejects.toThrow("changed");
    await expect(patchSchedule(db, "mine", { recurrenceId: "repeat", expectedOccurrenceVersion: 1, timeZone: "fake/zone" })).rejects.toThrow();
  });
  it("rejects foreign recurrence/task references, invalid dates and request reuse", async () => {
    const { db, records } = fixture();
    await expect(transitionOccurrence(db, "foreign", request)).rejects.toThrow("unavailable");
    records.task.brainInstanceId = "other";
    await expect(transitionOccurrence(db, "mine", request)).rejects.toThrow("unavailable");
    records.task.brainInstanceId = "mine";
    await expect(transitionOccurrence(db, "mine", { ...request, completedAt: NaN })).rejects.toThrow("Invalid date");
    await transitionOccurrence(db, "mine", request);
    await expect(transitionOccurrence(db, "mine", { ...request, action: "skip" })).rejects.toThrow("already used");
  });
  it("pauses and resumes without cancelling a live task or changing its due date/history", async () => {
    const { db, records } = fixture();
    await run(setRecurrenceStatusForViewer, db, { recurrenceId: "repeat", status: "paused", expectedOccurrenceVersion: 0 });
    expect(records.repeat).toMatchObject({ status: "paused", nextDueAt: due, currentTaskId: "task", occurrenceVersion: 1 });
    expect(records.task).toMatchObject({ status: "waiting", dueAt: due });
    await expect(transitionOccurrence(db, "mine", request)).rejects.toThrow("changed");
    await run(setRecurrenceStatusForViewer, db, { recurrenceId: "repeat", status: "active", expectedOccurrenceVersion: 1 });
    expect(records.repeat).toMatchObject({ status: "active", nextDueAt: due, occurrenceVersion: 2 });
    expect(records.repeat.history).toBeUndefined();
  });
  it("caps recent history and advances a very old daily schedule beyond now", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { db, records } = fixture({ rule: { kind: "interval", everyDays: 1 }, nextDueAt: now - 1000 * day, history: Array.from({ length: 24 }, (_, n) => ({ completedAt: n })) });
    await transitionOccurrence(db, "mine", { ...request, action: "skip" });
    expect(records.repeat.history).toHaveLength(24);
    expect(records.repeat.history[0]).toEqual({ completedAt: 1 });
    expect(records.repeat.nextDueAt).toBeGreaterThan(now);
    vi.restoreAllMocks();
  });
});
describe("owned task controls", () => {
  it("clears ordinary deadlines, validates edits, and rejects stale writes", async () => {
    const { db, records } = fixture(); records.repeat.currentTaskId = undefined;
    await run(updateLifeTask, db, { taskId: "task", title: "  Edited  ", description: "Updated", dueAt: null, expectedUpdatedAt: 1 });
    expect(records.task).toMatchObject({ title: "Edited", description: "Updated", dueAt: undefined });
    await expect(run(updateLifeTask, db, { taskId: "task", title: "stale", expectedUpdatedAt: 1 })).rejects.toThrow("changed");
    await expect(run(updateLifeTask, db, { taskId: "task", title: " " })).rejects.toThrow("required");
    await expect(run(updateLifeTask, db, { taskId: "task", dueAt: Infinity })).rejects.toThrow("Invalid date");
    await expect(run(updateLifeTask, db, { taskId: "other", title: "bad" })).rejects.toThrow("not found");
    await expect(run(createLifeTask, db, { title: "Want", commitment: "want", dueAt: now })).rejects.toThrow("Wants");
  });
  it("routes spawned task completion/cancellation atomically and protects scheduled deadlines", async () => {
    for (const status of ["done", "cancelled"]) {
      const { db, records } = fixture();
      await expect(run(updateLifeTask, db, { taskId: "task", dueAt: null })).rejects.toThrow("deadline");
      await run(setLifeTaskStatus, db, { taskId: "task", status });
      await run(setLifeTaskStatus, db, { taskId: "task", status });
      expect(records.repeat.history).toHaveLength(1);
      expect(records.repeat.history[0].outcome).toBe(status === "done" ? "completed" : "skipped");
      await expect(run(setLifeTaskStatus, db, { taskId: "task", status: "todo" })).rejects.toThrow("cannot be reopened");
    }
  });
  it("checks waiting target ownership and clears the waiting ledger", async () => {
    const { db, records } = fixture();
    await expect(run(setWaitingOn, db, { taskId: "task", waitingOn: { entityType: "person", entityId: "other" } })).rejects.toThrow("unavailable");
    records.person = { _id: "person", brainInstanceId: "mine" };
    await run(setWaitingOn, db, { taskId: "task", waitingOn: { entityType: "person", entityId: "person" } });
    expect(records.task).toMatchObject({ status: "waiting", waitingOn: { entityId: "person" } });
    await run(setWaitingOn, db, { taskId: "task", waitingOn: null });
    expect(records.task).toMatchObject({ status: "todo", waitingOn: undefined, waitingSince: undefined });
  });
});
