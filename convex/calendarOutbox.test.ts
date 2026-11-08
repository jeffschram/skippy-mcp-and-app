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
describe("automatic calendar outbox", () => {
  it("queues directly, deduplicates ready actions, and retains overlap warnings", async () => {
    const ctx = fixture();
    await ctx.db.insert("calendarEvents", { brainInstanceId, calendarId: "primary", sourceSystem: "google_calendar", externalId: "existing", title: "Meeting", startAt: 1000000, endAt: 2000000, status: "confirmed", remoteState: "synced" });
    const first = await run(draftCalendarEvent, ctx, { ...event, requireApproval: true });
    expect(await ctx.db.get(first.pendingActionId)).toMatchObject({ status: "approved" });
    expect(first.conflicts).toHaveLength(1);
    expect((await ctx.db.get(first.pendingActionId)).reviewWarning).toBeTruthy();
    const replay = await run(draftCalendarEvent, ctx, event);
    expect(replay.status).toBe("duplicate_pending");
    expect(replay.pendingActionId).toBe(first.pendingActionId);
    expect(ctx.rows.filter(r => r._id.startsWith("pendingActions:"))).toHaveLength(1);
  });
  it("keeps live leases out of duplicate sweeps and rejects stale claim results", async () => {
    const ctx = fixture();
    const first = await run(draftCalendarEvent, ctx, event);
    const action = await ctx.db.get(first.pendingActionId);
    const { _id, ...copy } = action;
    const duplicateId = await ctx.db.insert("pendingActions", { ...copy, createdAt: action.createdAt + 1 });
    const claimed = await run(claimNextCalendarAction, ctx, { hostToken: "host" });
    expect(claimed.pendingActionId).toBe(first.pendingActionId);
    await run(hostSweepDuplicatePendingActions, ctx, { hostToken: "host" });
    expect((await ctx.db.get(first.pendingActionId)).status).toBe("approved");
    expect((await ctx.db.get(duplicateId)).status).toBe("approved");
    expect(await run(recordCalendarActionResult, ctx, { hostToken: "host", pendingActionId: first.pendingActionId, claimToken: "stale", outcome: "created" })).toEqual({ status: "stale_claim" });
    await ctx.db.patch(first.pendingActionId, { leaseExpiresAt: 0 });
    await run(hostSweepDuplicatePendingActions, ctx, { hostToken: "host" });
    expect((await ctx.db.get(first.pendingActionId)).status).toBe("rejected");
    expect((await ctx.db.get(duplicateId)).status).toBe("approved");
  });
  it("treats a provider ID conflict as successful execution and logs the outcome", async () => {
    const ctx = fixture();
    const first = await run(draftCalendarEvent, ctx, event);
    const claim = await run(claimNextCalendarAction, ctx, { hostToken: "host" });
    const result = await run(recordCalendarActionResult, ctx, { hostToken: "host", pendingActionId: first.pendingActionId, claimToken: claim.claimToken, outcome: "conflict" });
    expect(result.status).toBe("completed");
    expect((await ctx.db.get(first.calendarEventId)).remoteState).toBe("synced");
    expect(ctx.rows.some(r => r.activityType === "calendar_action_completed")).toBe(true);
  });
});
