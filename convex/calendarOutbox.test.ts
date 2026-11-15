import { describe, expect, it, vi } from "vitest";
vi.mock("./agentWorkbench", () => ({ makeToken: () => "claim", requireHost: async () => ({ _id: "agentHosts:h", brainInstanceId: "brainInstances:b" }) }));
import { draftCalendarEvent, hostSweepDuplicatePendingActions, claimNextCalendarAction, recordCalendarActionResult } from "./calendar";
type Row = Record<string, any>;
function fixture() {
  const rows: Row[] = [{ _id: "agentHosts:h" }];
  let sequence = 0;
  const db: any = {
    get: async (id: string) => rows.find(r => r._id === id),
    insert: async (table: string, value: Row) => { const _id = `${table}:${++sequence}`; rows.push({ ...value, _id }); return _id; },
    patch: async (id: string, value: Row) => Object.assign(rows.find(r => r._id === id)!, value),
    query: (table: string) => {
      let found = rows.filter(r => r._id.startsWith(table + ":"));
      const range: any = {};
      for (const op of ["eq", "gte", "lte", "lt", "gt"]) range[op] = (key: string, val: any) => {
        found = found.filter(r => op === "eq" ? r[key] === val : op === "gte" ? r[key] >= val : op === "lte" ? r[key] <= val : op === "lt" ? r[key] < val : r[key] > val); return range;
      };
      const chain: any = { withIndex: (_name: string, fn: any) => { fn(range); return chain; }, collect: async () => found, take: async (n: number) => found.slice(0, n), first: async () => found[0] ?? null };
      return chain;
    },
  };
  return { db, rows };
}
const run = (fn: any, ctx: any, args: Row) => fn._handler(ctx, args);
const brainInstanceId = "brainInstances:b";
const event = { brainInstanceId, calendarId: "primary", title: "Lunch", startAt: 1000000, endAt: 2000000 };
describe("local calendar ownership", () => {
  it("saves locally, warns on overlaps and reuses an explicit retry identity", async () => {
    const ctx = fixture();
    await ctx.db.insert("calendarEvents", { brainInstanceId, calendarId: "primary", sourceSystem: "google_calendar", externalId: "existing", title: "Meeting", startAt: 1000000, endAt: 2000000, status: "confirmed", remoteState: "synced" });
    const first = await run(draftCalendarEvent, ctx, { ...event, eventId: "skp012345", requireApproval: true });
    expect(first.status).toBe("saved");
    expect(first.googleWritten).toBe(false);
    expect(first.conflicts).toHaveLength(1);
    expect(await ctx.db.get(first.calendarEventId)).toMatchObject({ sourceSystem: "skippy_calendar", origin: "skippy" });
    const replay = await run(draftCalendarEvent, ctx, { ...event, eventId: "skp012345" });
    expect(replay.status).toBe("already_saved");
    expect(replay.calendarEventId).toBe(first.calendarEventId);
    expect(ctx.rows.filter(r => r._id.startsWith("pendingActions:"))).toHaveLength(0);
  });
  it("never claims queued legacy writes and preserves their audit records", async () => {
    const ctx = fixture();
    const id = await ctx.db.insert("pendingActions", { brainInstanceId, status: "approved", actionType: "calendar_event_create", subject: "Legacy", createdAt: 1 });
    const before = structuredClone(ctx.rows);
    expect(await run(claimNextCalendarAction, ctx, { hostToken: "host" })).toBeNull();
    expect(ctx.rows).toEqual(before);
    expect(await run(recordCalendarActionResult, ctx, { hostToken: "host", pendingActionId: id, claimToken: "stale", outcome: "created" })).toEqual({ status: "stale_claim" });
  });
});
