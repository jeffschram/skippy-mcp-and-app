import { describe, it, expect, vi } from "vitest";
import { completeStepForViewer, forViewer } from "./today";
type Row = Record<string, any>;
function fixture(rows: Row[], signedIn = true) {
  const db = {
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    get: vi.fn(async (id: string) => rows.find(row => row._id === id) || null),
    insert: vi.fn(async () => "activity:1"),
    patch: vi.fn(async (id: string, patch: Row) => Object.assign(rows.find(row => row._id === id)!, patch)),
    query: (table: string) => {
      let matches = rows.filter(row => row._id.startsWith(`${table}:`));
      const field = (row: Row, path: string): unknown => path.split(".").reduce<unknown>((value, key) =>
        value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
      const range: Row = {};
      for (const op of ["eq", "gt", "gte", "lt", "lte"]) range[op] = (key: string, value: unknown) => {
        matches = matches.filter(row => {
          const actual = field(row, key);
          if (op === "eq") return actual === value;
          if (typeof actual !== "number" || typeof value !== "number") return false;
          return op === "gt" ? actual > value : op === "gte" ? actual >= value : op === "lt" ? actual < value : actual <= value;
        });
        return range;
      };
      const chain = {
        filter: () => chain,
        unique: async () => ({ _id: "users:me" }),
        first: async () => ({ _id: "brain:mine" }),
        withIndex: (_name: string, callback: (range: Row) => unknown) => { callback(range); return chain; },
        order: () => chain,
        take: async (count: number) => matches.slice(0, count),
        paginate: async () => ({ page: matches, isDone: true, continueCursor: "" }),
      };
      return chain;
    },
  };
  return { db, auth: { getUserIdentity: async () => signedIn ? { subject: "me" } : null } };
}
const run = (fn: unknown, ctx: ReturnType<typeof fixture>, args: Row): Promise<any> => (fn as { _handler: (ctx: unknown, args: unknown) => Promise<any> })._handler(ctx, args);
const now = 1_800_000_000_000;
const item = (id: string, extra: Row = {}): Row => ({ _id: id, brainInstanceId: "brain:mine", title: `Call about ${id}`, processingState: "accepted", ...extra });

const dayStart = now - 3600000, dayEnd = now + 10 * 3600000;
const plan = (rows: Row[], signedIn = true) => run(forViewer, fixture(rows, signedIn), { now, dayStart, dayEnd });
describe("Home daily plan", () => {
  it("requires an owner and never returns another brain's work", async () => {
    await expect(plan([], false)).rejects.toThrow();
    const result = await plan([item("tasks:mine", { status: "todo" }), item("tasks:other", { status: "todo", brainInstanceId: "brain:other" })]);
    expect(result.items.map((x: Row) => x.id)).toEqual(["tasks:mine"]);
  });
  it("excludes waiting, completed, snoozed and routine agent work but includes agent decisions", async () => {
    const result = await plan([
      item("tasks:wait", { status: "waiting" }), item("tasks:done", { status: "done" }),
      item("tasks:later", { status: "todo", focusSnoozedUntil: dayEnd }),
      item("tasks:agent", { status: "in_progress", ownerType: "agent" }),
      item("tasks:decision", { status: "in_progress", ownerType: "agent", executionState: "in_review" }),
    ]);
    expect(result.items.map((x: Row) => x.id)).toEqual(["tasks:decision"]);
    expect(result.items[0].canComplete).toBe(false);
  });
  it("excludes archived projects and unresolved dependencies, and links project work correctly", async () => {
    const rows = [item("tasks:active", { status: "todo" }), item("tasks:old", { status: "todo" }), item("tasks:blocked", { status: "todo" }),
      item("projects:p", { status: "in_progress" }), item("projects:old", { status: "archived" }),
      item("relationships:1", { type: "belongs_to", from: { entityType: "task", entityId: "tasks:active" }, to: { entityType: "project", entityId: "projects:p" } }),
      item("relationships:2", { type: "belongs_to", from: { entityType: "task", entityId: "tasks:old" }, to: { entityType: "project", entityId: "projects:old" } }),
      item("relationships:3", { type: "depends_on", from: { entityType: "task", entityId: "tasks:blocked" }, to: { entityType: "task", entityId: "tasks:active" } }),
    ];
    const result = await plan(rows);
    expect(result.items.map((x: Row) => x.id)).toEqual(["tasks:active"]);
    expect(result.items[0].href).toBe("/projects/projects:p#task-tasks:active");
  });
  it("represents a spawned recurrence once and completes through its recurrence", async () => {
    const result = await plan([item("tasks:repeat", { status: "todo", dueAt: now }), item("recurrences:r", { status: "active", nextDueAt: now, currentTaskId: "tasks:repeat" })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].recurrenceId).toBe("recurrences:r");
  });
  it("retains explicit reference reminders and routes approvals to chat", async () => {
    const result = await plan([item("people:p", { name: "Call Pat", attention: { reviewAt: now - 1 } }), item("pendingActions:a", { status: "pending_approval", actionType: "send_email", subject: "Reply to Pat" })]);
    expect(result.items.map((x: Row) => x.kind).sort()).toEqual(["approval", "reminder"]);
    expect(result.items.find((x: Row) => x.kind === "approval").href).toBe("/?chat=1");
  });
  it("omits large project initiatives and selects at most one recorded owner step", async () => {
    const tasks = [
      item('tasks:large', { status: 'todo', kind: 'coding', title: 'Build an AI image pipeline', priorityScore: 100 }),
      item('tasks:step', { status: 'todo', kind: 'coding', title: 'Build a generator', description: '- [ ] Choose the mockup style\n- [ ] Build the image pipeline' }),
      item('tasks:other', { status: 'todo', kind: 'design', title: 'Choose a font' }),
      item('tasks:personal', { status: 'todo', title: 'Pay utility bill', dueAt: now }),
    ];
    const result = await plan(tasks);
    expect(result.items.map((x: Row) => x.id)).toEqual(['tasks:personal', 'tasks:other']);
    const stepOnly = await plan(tasks.slice(0, 2));
    expect(stepOnly.items[0]).toMatchObject({ title: 'Choose the mockup style', stepLine: 0, projectStep: true, kind: 'step', canComplete: false });
    expect(stepOnly.summary).not.toContain('Build a generator');
  });
  it("turns a whole-project deadline into a decision without a completion checkbox", async () => {
    const result = await plan([item('tasks:large', { status: 'todo', kind: 'coding', title: 'Build a generator', dueAt: now })]);
    expect(result.items[0]).toMatchObject({ canComplete: false, projectStep: false, required: true });
    expect(result.items[0].title).toContain('Decide the next action');
  });
  it("completes only the recorded step, rejects stale or foreign writes, and safely retries", async () => {
    const task = item('tasks:step', { status: 'in_progress', description: '- [ ] Choose a font\n- [ ] Email Pat' });
    const ctx = fixture([task]);
    const args = { taskId: task._id, stepLine: 0, stepSource: '- [ ] Choose a font' };
    await run(completeStepForViewer, ctx, args);
    expect(task.description).toBe('- [x] Choose a font\n- [ ] Email Pat');
    expect(task.status).toBe('in_progress');
    expect(task.completedAt).toBeUndefined();
    await run(completeStepForViewer, ctx, args);
    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    await expect(run(completeStepForViewer, ctx, { ...args, stepLine: 1 })).rejects.toThrow('changed');
    await expect(run(completeStepForViewer, fixture([task], false), args)).rejects.toThrow();
    task.brainInstanceId = 'brain:other';
    await expect(run(completeStepForViewer, ctx, args)).rejects.toThrow('not found');
  });
  it("keeps automatic notices out of action recommendations and supports the upcoming week", async () => {
    const rows = [item('tasks:auto', { status: 'todo', title: 'GEICO auto-pay processes', dueAt: now }),
      item('recurrences:auto', { title: 'Figma auto-renews', status: 'active', nextDueAt: now }),
      item('tasks:funds', { status: 'todo', title: 'Chase checking is low — move money before upcoming auto-payments', dueAt: now }),
      item('tasks:future', { status: 'todo', title: 'Book a dentist visit', dueAt: dayEnd + 86400000 })];
    expect((await plan(rows)).items.map((x: Row) => x.id)).toEqual(['tasks:funds']);
    const week = await run(forViewer, fixture(rows), { now, dayStart: dayEnd, dayEnd: dayEnd + 7 * 86400000, period: 'week' });
    expect(week.items.map((x: Row) => x.id)).toEqual(['tasks:future']);
  });
  it("counts mirrored events once and ignores cancelled copies", async () => {
    const result = await plan([
      item("calendarEvents:a", { title: "Dinner", startAt: now, endAt: now + 3600000, status: "confirmed" }),
      item("calendarEvents:b", { title: "Dinner", startAt: now, endAt: now + 3600000, status: "confirmed" }),
      item("calendarEvents:c", { title: "Other", startAt: now, endAt: now + 3600000, status: "cancelled" }),
    ]);
    expect(result.summary).toContain("1 appointment remains");
    expect(result.busyMinutes).toBe(60);
  });

});
