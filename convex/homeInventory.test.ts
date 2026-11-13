import { describe, expect, it, vi } from "vitest";
import { page, getForViewer, seek } from "./homeInventory";
import schema from "./schema";
import { homePeriods } from "../apps/web/app/hubs/home-planning-helpers";
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
        take: async (n: number) => { expect(n).toBeLessThanOrEqual(65); reads += Math.min(n, rows.length); return rows.slice(0, n); },
        first: async () => { reads++; return rows[0] ?? null; },
      }; return chain;
    },
  } } };
}
const args = { period: "all", now: 1000, start: 900, tomorrow: 2000, weekEnd: 8000, overdueStart: 200,
  horizon: 100000, utcToday: 900, utcTomorrow: 2000, utcWeekEnd: 8000, status: "open" };
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
  it.each(["today", "week", "all"])("paginates %s across areas without losing row metadata", async period => {
    const areas = ["work", "health", undefined];
    const records: Row[] = Array.from({ length: 75 }, (_, n) => task(String(n).padStart(3, "0"), {
      dueAt: period === "week" ? 3000 : 1200, area: areas[n % areas.length],
    }));
    const first = await run(page, fixture(records).ctx, { ...args, period });
    expect(first.rows).toHaveLength(period === "all" ? 50 : 20);
    expect(first.hasMore).toBe(true);
    const rows = await inventory(records, { period });
    expect(rows.map(r => r.id)).toEqual(records.map(r => r._id));
    expect(rows.map(r => r.area)).toEqual(records.map(r => r.area ?? null));
  });
  it("resolves recurrence claims before periods/projects and surfaces stale claims", async () => {
    const rows = await inventory([task("far", { dueAt: 50000 }), recurrence("claimed", { currentTaskId: "tasks:far" }),
      recurrence("missing", { currentTaskId: "tasks:missing" }), recurrence("done", { currentTaskId: "tasks:closed" }), task("closed", { status: "done" })], { period: "today" });
    expect(rows.map(r => r.id)).toEqual(["recurrences:done", "recurrences:missing"]);
  });
  it("keeps distinct same-title events/tasks and ongoing old events", async () => {
    const records = [task("task", { title: "Meeting", area: "work" }), event("event", { title: "Meeting" }), event("long", { startAt: -10000, endAt: 3000 }), event("ended", { endAt: 1000 }), event("master", { isMaster: true })];
    expect((await inventory(records)).map(r => r.id)).toEqual(["calendarEvents:long", "calendarEvents:event", "tasks:task"]);
    expect((await inventory(records)).find(r => r.id === "tasks:task")?.area).toBe("work");
  });
  it("moves an updated mirrored event between periods and hides its cancellation", async () => {
    const mirrored = event("stable-id");
    expect((await inventory([mirrored], { period: "today" })).map(r => r.id)).toEqual([mirrored._id]);
    Object.assign(mirrored, { title: "Rescheduled", startAt: 3000, endAt: 4000 });
    expect(await inventory([mirrored], { period: "today" })).toEqual([]);
    expect((await inventory([mirrored], { period: "week" })).map(r => r.id)).toEqual([mirrored._id]);
    mirrored.status = "cancelled";
    for (const period of ["today", "week", "all"]) expect(await inventory([mirrored], { period })).toEqual([]);
  });
  it("preserves completed and paused history, with paused live repeats represented by their task", async () => {
    const records = [task("closed", { status: "done" }), task("live"), recurrence("paused", { status: "paused", currentTaskId: "tasks:live" }), recurrence("retired", { status: "retired" })];
    expect((await inventory(records, { status: "completed" })).map(r => r.id)).toEqual(["tasks:closed"]);
    expect((await inventory(records, { status: "paused" })).map(r => r.id)).toEqual(["tasks:live", "recurrences:retired"]);
  });
  it("keeps rolling Upcoming nonempty on Sunday and disjoint from Today", async () => {
    const periods = homePeriods(new Date(2026, 10, 8, 12).getTime());
    const records = [
      task("today", { dueAt: periods.start }),
      task("tomorrow", { dueAt: periods.tomorrow }),
      task("last-day", { dueAt: periods.weekEnd - 1 }),
      task("outside", { dueAt: periods.weekEnd }),
      task("want", { commitment: "want" }),
      task("old", { dueAt: periods.overdueStart - 1 }),
      recurrence("tomorrow", { nextDueAt: periods.tomorrow }),
      event("ongoing", { startAt: periods.start - 1, endAt: periods.weekEnd }),
      event("tomorrow", { startAt: periods.tomorrow, endAt: periods.tomorrow + 1000 }),
      event("outside", { startAt: periods.weekEnd, endAt: periods.weekEnd + 1000 }),
      event("all-day", { startAt: periods.utcTomorrow, endAt: periods.utcWeekEnd, isAllDay: true }),
      event("all-day-outside", { startAt: periods.utcWeekEnd, endAt: periods.utcWeekEnd + 86400000, isAllDay: true }),
    ];
    const today = await inventory(records, { ...periods, period: "today" });
    const upcoming = await inventory(records, { ...periods, period: "week" });
    expect(today.map(r => r.id).sort()).toEqual(["calendarEvents:ongoing", "tasks:today"]);
    expect(upcoming.map(r => r.id).sort()).toEqual([
      "calendarEvents:all-day", "calendarEvents:tomorrow", "recurrences:tomorrow", "tasks:last-day", "tasks:tomorrow",
    ]);
    expect(upcoming.some(r => today.some(t => t.id === r.id))).toBe(false);
    expect(await inventory([], { ...periods, period: "today" })).toEqual([]);
    expect(await inventory([], { ...periods, period: "week" })).toEqual([]);
  });
  it("ignores legacy task review dates without changing placement", async () => {
    const rows = await inventory([
      task("review", { attention: { reviewAt: 0 } }),
      task("undated-review", { dueAt: undefined, attention: { reviewAt: 0 } }),
      event("event"), recurrence("repeat"),
    ], { period: "today" });
    expect(rows.find(row => row.id === "tasks:review")?.reviewAt).toBeNull();
    expect(rows.some(row => row.id === "tasks:undated-review")).toBe(false);
    expect(rows.filter(row => row.kind !== "task").every(row => row.reviewAt === null)).toBe(true);
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
      { _id: "projects:p", brainInstanceId: "mine", kind: "code" },
      { _id: "relationships:project", brainInstanceId: "mine", from: { entityId: "tasks:project" }, to: { entityType: "project", entityId: "projects:p" }, type: "belongs_to" }];
    expect(await inventory(records)).toEqual([]);
    expect(await inventory(records, { period: "today" })).toEqual([]);
  });
  // 2026-11-10: a task due today inside a personal project reached no surface at
  // all. Only code-project roadmap churn may be hidden from Home.
  it("shows tasks in general projects but hides code-project roadmap tasks", async () => {
    const link = (task: string, project: string) => ({ _id: `relationships:${task}`, brainInstanceId: "mine",
      from: { entityId: `tasks:${task}` }, to: { entityType: "project", entityId: `projects:${project}` }, type: "belongs_to" });
    const records = [task("thanksgiving"), task("ship"), task("legacy"), task("orphan"),
      { _id: "projects:general", brainInstanceId: "mine", kind: "general" },
      { _id: "projects:code", brainInstanceId: "mine", kind: "code" },
      { _id: "projects:untyped", brainInstanceId: "mine" },
      link("thanksgiving", "general"), link("ship", "code"), link("legacy", "untyped"), link("orphan", "deleted")];
    for (const period of ["today", "all"]) {
      const rows = await inventory(records, { period });
      expect(rows.map(r => r.id).sort()).toEqual(["tasks:legacy", "tasks:orphan", "tasks:thanksgiving"]);
    }
  });
  it("resolves exact archived/project records and rejects foreign or wrong-kind IDs", async () => {
    const db = fixture([task("closed", { status: "done" }), task("foreign", { brainInstanceId: "other" }),
      { _id: "relationships:project", brainInstanceId: "mine", from: { entityId: "tasks:closed" }, to: { entityType: "project", entityId: "projects:p" }, type: "belongs_to" }]);
    expect(await run(getForViewer, db.ctx, { kind: "task", id: "tasks:closed" })).toMatchObject({ projectId: "projects:p", row: { status: "done" } });
    expect(await run(getForViewer, db.ctx, { kind: "task", id: "tasks:foreign" })).toBeNull();
    expect(await run(getForViewer, db.ctx, { kind: "event", id: "tasks:closed" })).toBeNull();
  });
  it("loads canonical dates, recurrence context and only owned sources, then reflects deletion", async () => {
    const records: Row[] = [task("a", { description: "Canonical description", completedAt: 1500 }),
      recurrence("r", { currentTaskId: "tasks:a", rule: { kind: "interval", everyDays: 3 }, anchor: "completion", lastCompletedAt: 800 }),
      { _id: "entitySourceRefs:own", brainInstanceId: "mine", entityRef: { entityType: "task", entityId: "tasks:a" }, sourceRefId: "sourceRefs:own" },
      { _id: "entitySourceRefs:foreign", brainInstanceId: "mine", entityRef: { entityType: "task", entityId: "tasks:a" }, sourceRefId: "sourceRefs:foreign" },
      { _id: "sourceRefs:own", brainInstanceId: "mine", sourceSystem: "email", url: "https://example.com/message" },
      { _id: "sourceRefs:foreign", brainInstanceId: "other", sourceSystem: "private", url: "https://example.com/private" }];
    const { ctx } = fixture(records);
    const input = { kind: "task", id: "tasks:a" };
    const detail = await run(getForViewer, ctx, input);
    expect(detail.description).toBe("Canonical description");
    expect(detail.recurrence).toContain("Every 3 days");
    expect(detail.dates).toContainEqual({ label: "Last completed", at: 800 });
    expect(detail.sources).toEqual([{ label: "Open source · example.com", url: "https://example.com/message" }]);
    records[0]!.description = "Changed";
    expect((await run(getForViewer, ctx, input)).description).toBe("Changed");
    records.shift();
    expect(await run(getForViewer, ctx, input)).toBeNull();
  });

  it("reflects deadline clearing and waiting/completion across every period", async () => {
    const records: Row[] = [task("changing")];
    expect(await inventory(records, { period: "today" })).toHaveLength(1);
    records[0]!.dueAt = 3000;
    records[0]!.status = "waiting";
    expect(await inventory(records, { period: "today" })).toHaveLength(0);
    expect((await inventory(records, { period: "week" }))[0]).toMatchObject({ status: "waiting", isWaiting: true });
    records[0]!.dueAt = undefined;
    expect(await inventory(records, { period: "week" })).toHaveLength(0);
    expect((await inventory(records))[0]).toMatchObject({ at: null });
    records[0]!.status = "done";
    expect(await inventory(records)).toHaveLength(0);
    expect(await inventory(records, { status: "completed" })).toHaveLength(1);
  });
  it("uses stored event links and encodes locations as a Maps query", async () => {
    const { ctx } = fixture([event("links", { htmlLink: "https://calendar.google.com/event?id=1", conferenceUrl: "https://meet.google.com/abc", location: "Main & 1st #2" })]);
    const detail = await run(getForViewer, ctx, { kind: "event", id: "calendarEvents:links" });
    expect(detail.sources).toContainEqual({ label: "Calendar event", url: "https://calendar.google.com/event?id=1" });
    expect(detail.sources).toContainEqual({ label: "Join meeting", url: "https://meet.google.com/abc" });
    expect(detail.sources).toContainEqual({ label: "Open in Maps", url: "https://www.google.com/maps/search/?api=1&query=Main%20%26%201st%20%232" });
  });

});

const review = (table: string, id: string, extra: Row = {}) => ({ _id: `${table}:${id}`, _creationTime: 1, brainInstanceId: "mine", processingState: "accepted", attention: { reviewAt: 0 }, ...extra });
describe("review inventory", () => {
  it("projects every supported kind, fallback names, and canonical detail identity", async () => {
    const records = [review("goals", "g", { title: "Goal", status: "achieved" }), review("projects", "p", { title: "Project" }), review("people", "p", { name: "Person" }), review("companies", "c", { name: "Company" }), ...["note", "link", "memory"].map(kind => review("knowledge", kind, { kind }))];
    const rows = await inventory(records, { period: "today" });
    expect(rows).toHaveLength(7);
    expect(rows.every(row => row.kind === "review" && row.at === 0 && !row.isWaiting && !row.recurrenceId && row.attentionResult.status === "stale")).toBe(true);
    expect(rows.find(row => row.entityKind === "person").title).toBe("Person");
    for (const row of rows) expect((await run(getForViewer, fixture(records).ctx, { kind: "review", id: row.id })).row.entityKind).toBe(row.entityKind);
    expect(await run(getForViewer, fixture([task("a")]).ctx, { kind: "review", id: "tasks:a" })).toBeNull();
    expect(await run(getForViewer, fixture([review("knowledge", "x", { kind: "invalid" })]).ctx, { kind: "review", id: "knowledge:x" })).toBeNull();
    expect(await run(getForViewer, fixture([review("people", "x", { brainInstanceId: "other" })]).ctx, { kind: "review", id: "people:x" })).toBeNull();
  });
  it("applies manual, dated, scheduled-only and automatic placement without duplicates", async () => {
    const records = [
      review("people", "old"),
      review("people", "future-immediate", { attention: { override: "immediate", reviewAt: 99999 } }),
      review("people", "undated-immediate", { attention: { override: "immediate" } }),
      ...["todo", "in_progress", "stale"].map(override => review("people", override, { attention: { override } })),
      review("projects", "active", { status: "in_progress", attention: {} }),
      review("people", "tomorrow", { attention: { override: "todo", reviewAt: 2000, scheduledAt: 1 } }),
      review("people", "scheduled", { attention: { scheduledAt: 7999 } }),
      review("people", "outside", { attention: { override: "todo", reviewAt: 8000 } }),
      review("people", "ok", { attention: { override: "ok", reviewAt: 2000 } }),
      review("people", "unassessed", { attention: {} }),
      review("people", "snoozed", { focusSnoozedUntil: 1001 }),
      ...["archived", "discarded"].map(status => review("people", status, { status })),
      review("people", "archived-review", { reviewState: "archived" }),
      review("people", "candidate", { processingState: "candidate" }),
      task("normal", { attention: { reviewAt: 0, override: "immediate" } }),
    ];
    expect((await inventory(records, { period: "today" })).map(r => r.id).sort()).toEqual(["people:future-immediate", "people:old", "people:undated-immediate", "tasks:normal"]);
    expect((await inventory(records, { period: "week" })).map(r => r.id).sort()).toEqual(["people:scheduled", "people:tomorrow"]);
    const all = await inventory(records);
    expect(all).toHaveLength(11); expect(new Set(all.map(r => r.id)).size).toBe(11);
    expect(await inventory(records, { status: "completed" })).toEqual([]);
  });
  it("seeks nested dates and equal timestamp/creation ties across page boundaries losslessly", async () => {
    const records = Array.from({ length: 170 }, (_, i) => review("people", String(i).padStart(3, "0"), { name: String(170 - i), attention: { override: "todo", reviewAt: i < 85 ? 0 : 2000, scheduledAt: 0 } }));
    records.push(...Array.from({ length: 70 }, (_, i) => review("projects", String(i), { status: "in_progress", attention: { override: "in_progress" } })));
    const all = await inventory(records);
    expect(all).toHaveLength(240); expect(new Set(all.map(r => r.id)).size).toBe(240);
    expect((await inventory(records, { period: "today" }))).toHaveLength(85);
    expect((await inventory(records, { period: "week" }))).toHaveLength(85);
  });
});

it("encodes missing index values explicitly across a seek cursor", async () => {
  const records = [task("a", { attention: {} }), task("b", { attention: {} }), task("c", { attention: { reviewAt: 0 } })];
  const source = { table: "tasks", index: "by_brain_review", prefix: [["brainInstanceId", "mine"], ["processingState", "accepted"]], fields: ["attention.reviewAt", "_creationTime", "_id"] };
  const db = fixture(records).ctx.db;
  expect((await seek(db, source, null, 1))[0]._id).toBe("tasks:a");
  const cursor = JSON.parse(JSON.stringify([{ undefined: true }, 1, "tasks:a"]));
  expect((await seek(db, source, cursor, 2)).map(row => row._id)).toEqual(["tasks:b", "tasks:c"]);
});


it("validates source protocols on the server and falls back to Gmail IDs", async () => {
  const refs = [
    { url: "javascript:alert(1)", deepLink: "https://example.com/safe" },
    { url: "https://user:password@example.com/private" },
    { sourceSystem: "gmail", threadId: "18abc123456789ab", url: "data:text/html,bad" },
    { sourceSystem: "google_mail", messageId: "18abc123456789ac" },
    { sourceSystem: "gmail", threadId: "bad/id" },
    { url: "https://example.com/safe" },
    { sourceSystem: "gmail", threadId: "18abc123456789ad", brainInstanceId: "other" },
  ].map((extra, i) => ({ _id: `sourceRefs:${i}`, sourceSystem: "web", brainInstanceId: "mine", ...extra }));
  const { ctx } = fixture([task("sources", { sourceRefIds: refs.map(ref => ref._id) }), ...refs]);
  const detail = await run(getForViewer, ctx, { kind: "task", id: "tasks:sources" });
  expect(detail.sources.map((source: any) => source.url)).toEqual([
    "https://example.com/safe", "https://mail.google.com/mail/u/0/#all/18abc123456789ab",
    "https://mail.google.com/mail/u/0/#all/18abc123456789ac",
  ]);
  const unsafe = await run(getForViewer, fixture([event("unsafe", { htmlLink: "javascript:alert(1)", conferenceUrl: "data:text/html,bad" })]).ctx,
    { kind: "event", id: "calendarEvents:unsafe" });
  expect(unsafe.sources).toEqual([]);
});
