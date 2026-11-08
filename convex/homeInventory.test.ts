import { describe, expect, it, vi } from "vitest";
import { page, getForViewer } from "./homeInventory";
import schema from "./schema";
vi.mock("./auth", () => ({ requireOwnedBrain: async () => ({ brain: { _id: "mine" } }) }));
type Row = Record<string, any>;
const field = (row: Row, key: string) => key.split(".").reduce((value, part) => value?.[part], row);
const cmp = (a: any, b: any) => a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1;
function fixture(records: Row[]) {
  let reads = 0;
  return { get reads() { return reads; }, ctx: { db: {
    normalizeId: (table: string, id: string) => id.startsWith(table + ":") ? id : null,
    get: async (id: string) => { reads++; return records.find(r => r._id === id) ?? null; },
    query: (table: string) => {
      let rows = records.filter(r => r._id.startsWith(table + ":"));
      const chain = {
        withIndex: (name: string, cb: (q: any) => unknown) => {
          const index = (schema.tables as any)[table].indexes.find((i: any) => i.indexDescriptor === name);
          const fields = [...index.fields, "_creationTime", "_id"];
          let position = 0; let ranged: string | null = null;
          const q: Row = {};
          for (const op of ["eq", "gt", "gte", "lt"]) q[op] = (key: string, value: any) => {
            expect(key).toBe(ranged ?? fields[position]);
            if (op === "eq") position++; else ranged = key;
            rows = rows.filter(r => { const c = cmp(field(r, key), value); return op === "eq" ? c === 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : c < 0; });
            return q;
          };
          cb(q);
          rows.sort((a, b) => { for (const key of fields) { const c = cmp(field(a, key), field(b, key)); if (c) return c; } return 0; });
          return chain;
        },
        take: async (n: number) => { expect(n).toBeLessThanOrEqual(51); reads += Math.min(n, rows.length); return rows.slice(0, n); },
        first: async () => { reads++; return rows[0] ?? null; },
      }; return chain;
    },
  } } };
}
const args = { period: "all", now: 1000, start: 900, tomorrow: 2000, weekEnd: 8000, overdueStart: 200,
  horizon: 100000, utcToday: 900, utcTomorrow: 2000, utcWeekEnd: 8000, area: null, status: "open" };
const task = (id: string, extra: Row = {}) => ({ _id: `tasks:${id}`, _creationTime: 1, brainInstanceId: "mine", title: id,
  processingState: "accepted", status: "todo", dueAt: 1200, ...extra });
const recurrence = (id: string, extra: Row = {}) => ({ _id: `recurrences:${id}`, _creationTime: 1, brainInstanceId: "mine", title: id, status: "active", nextDueAt: 1300, ...extra });
const event = (id: string, extra: Row = {}) => ({ _id: `calendarEvents:${id}`, _creationTime: 1, brainInstanceId: "mine", title: id, status: "confirmed", startAt: 1200, endAt: 1400, ...extra });
const run = (fn: any, ctx: any, input: any) => fn._handler(ctx, input);
async function inventory(records: Row[], input: Row = {}) {
  const db = fixture(records); const rows: any[] = []; let cursor: string | undefined;
  for (let n = 0; n < 100; n++) {
    const before = db.reads;
    const result = await run(page, db.ctx, { ...args, ...input, ...(cursor ? { cursor } : {}) });
    expect(db.reads - before).toBeLessThan(1100);
    rows.push(...result.rows);
    if (!result.hasMore) return rows;
    expect(result.cursor).not.toBe(cursor); cursor = result.cursor;
  }
  throw new Error("Pagination failed to terminate");
}
describe("bounded Home inventory", () => {
  it("pages through ties, filtered records, undated tasks and malformed dated wants without loss or duplicates", async () => {
    const records = Array.from({ length: 160 }, (_, n) => task(String(n).padStart(3, "0"), { title: "Same title", status: n % 5 === 0 ? "done" : "todo" }));
    records.push(task("undated", { dueAt: undefined }), task("want", { commitment: "want", dueAt: 10 }));
    const rows = await inventory(records);
    expect(rows).toHaveLength(130); expect(new Set(rows.map(r => r.id)).size).toBe(130);
    expect(rows.at(-2).id).toBe("tasks:undated"); expect(rows.at(-1)).toMatchObject({ id: "tasks:want", at: null });
  });
  it("resolves recurrence claims before periods/projects and surfaces stale claims", async () => {
    const rows = await inventory([task("far", { dueAt: 50000 }), recurrence("claimed", { currentTaskId: "tasks:far" }),
      recurrence("missing", { currentTaskId: "tasks:missing" }), recurrence("done", { currentTaskId: "tasks:closed" }), task("closed", { status: "done" })], { period: "today" });
    expect(rows.map(r => r.id)).toEqual(["recurrences:done", "recurrences:missing"]);
  });
  it("keeps distinct same-title events/tasks, ongoing old events, and events under area filters", async () => {
    const records = [task("task", { title: "Meeting", area: "work" }), event("event", { title: "Meeting" }), event("long", { startAt: -10000, endAt: 3000 }), event("ended", { endAt: 1000 }), event("master", { isMaster: true })];
    expect((await inventory(records)).map(r => r.id)).toEqual(["calendarEvents:long", "calendarEvents:event", "tasks:task"]);
    expect((await inventory(records, { area: "health" })).map(r => r.kind)).toEqual(["event", "event"]);
  });
  it("preserves completed and paused history, with paused live repeats represented by their task", async () => {
    const records = [task("closed", { status: "done" }), task("live"), recurrence("paused", { status: "paused", currentTaskId: "tasks:live" }), recurrence("retired", { status: "retired" })];
    expect((await inventory(records, { status: "completed" })).map(r => r.id)).toEqual(["tasks:closed"]);
    expect((await inventory(records, { status: "paused" })).map(r => r.id)).toEqual(["tasks:live", "recurrences:retired"]);
  });
  it("uses exclusive boundaries, excludes wants from periods and has an empty Sunday week", async () => {
    const records = [task("today"), task("tomorrow", { dueAt: 2000 }), task("want", { commitment: "want" }), task("old", { dueAt: 199 })];
    expect((await inventory(records, { period: "today" })).map(r => r.id)).toEqual(["tasks:today"]);
    expect(await inventory(records, { period: "week", weekEnd: 2000, utcWeekEnd: 2000 })).toEqual([]);
  });
  it("keeps all-day dates unshifted and extends the calendar horizon without losing earlier events", async () => {
    const records = [event("all-day", { startAt: 800, endAt: 1800, isAllDay: true }),
      event("future", { startAt: 110000, endAt: 120000 }), task("old", { dueAt: -1000 }),
      recurrence("future-repeat", { nextDueAt: 900000 })];
    const today = await inventory(records, { period: "today", start: 1200, now: 1300, utcToday: 800, utcTomorrow: 1800 });
    expect(today.map(r => r.id)).toContain("calendarEvents:all-day");
    const initial = await inventory(records);
    expect(initial.map(r => r.id)).toContain("tasks:old");
    expect(initial.map(r => r.id)).toContain("recurrences:future-repeat");
    expect(initial.map(r => r.id)).not.toContain("calendarEvents:future");
    const extended = await inventory(records, { horizon: 200000 });
    expect(extended.map(r => r.id)).toEqual(expect.arrayContaining(initial.map(r => r.id)));
    expect(extended.map(r => r.id)).toContain("calendarEvents:future");
  });
  it("never revives a repeat whose live task moved to a project outside the period", async () => {
    const records = [task("project", { dueAt: 50000 }), recurrence("repeat", { currentTaskId: "tasks:project" }),
      { _id: "relationships:project", brainInstanceId: "mine", from: { entityId: "tasks:project" }, to: { entityType: "project", entityId: "projects:p" }, type: "belongs_to" }];
    expect(await inventory(records)).toEqual([]);
    expect(await inventory(records, { period: "today" })).toEqual([]);
  });
  it("resolves exact archived/project records and rejects foreign or wrong-kind IDs", async () => {
    const db = fixture([task("closed", { status: "done" }), task("foreign", { brainInstanceId: "other" }),
      { _id: "relationships:project", brainInstanceId: "mine", from: { entityId: "tasks:closed" }, to: { entityType: "project", entityId: "projects:p" }, type: "belongs_to" }]);
    expect(await run(getForViewer, db.ctx, { kind: "task", id: "tasks:closed" })).toMatchObject({ projectId: "projects:p", row: { status: "done" } });
    expect(await run(getForViewer, db.ctx, { kind: "task", id: "tasks:foreign" })).toBeNull();
    expect(await run(getForViewer, db.ctx, { kind: "event", id: "tasks:closed" })).toBeNull();
  });
});
