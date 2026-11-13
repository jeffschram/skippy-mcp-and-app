import { describe, expect, it, vi, afterEach } from "vitest";
import { ingestObject, recordMemoryForBrain, recordIngestionRun, updateSourceSyncStatus, markQuickCaptureHandledForBrain, listQuickCapturesForBrain } from "./knowledge";
vi.mock("./agentWorkbench", async (importOriginal) => ({
  ...await importOriginal<typeof import("./agentWorkbench")>(),
  requireHost: async () => ({ brainInstanceId: "brain:b" }),
}));
import { upsertCalendarEvents, hostClaimCalendarSync, hostUpsertCalendarEvents, hostRecordCalendarSyncToken } from "./calendar";
import { LEASE_MS, OVERLAP_MS, WINDOW_MS } from "./ingestionProgress";

type Row = Record<string, any>;
// Mutation fixture models atomic rollback and serial execution. Production
// Convex OCC additionally retries conflicting indexed reads on commit.
function fixture() {
  let rows: Row[] = [];
  let seq = 0;
  let failTable = "";
  const db: any = {
    get: async (id: string) => rows.find(r => r._id === id),
    insert: async (table: string, value: Row) => {
      if (table === failTable) throw new Error("injected persistence failure");
      const _id = `${table}:${++seq}`; rows.push({ ...structuredClone(value), _id }); return _id;
    },
    delete: async (id: string) => { rows = rows.filter(r => r._id !== id); },
    patch: async (id: string, value: Row) => Object.assign(rows.find(r => r._id === id)!, structuredClone(value)),
    query: (table: string) => {
      let found = rows.filter(r => r._id.startsWith(table + ":"));
      const range: any = { eq: (key: string, value: any) => { found = found.filter(r => r[key] === value); return range; } };
      const chain: any = { withIndex: (_: string, fn: any) => { fn(range); return chain; },
        filter: (fn: any) => {
          const expression = { field: (key: string) => (r: Row) => key.split(".").reduce((value, part) => value?.[part], r),
            eq: (field: any, value: any) => (r: Row) => field(r) === value };
          found = found.filter(fn(expression)); return chain;
        },
        order: (direction: string) => { if (direction === "desc") found.reverse(); return chain; },
        first: async () => found[0] ?? null, take: async (n: number) => found.slice(0, n), collect: async () => found };
      return chain;
    },
  };
  return {
    rows: () => rows, fail: (table: string) => { failTable = table; }, db,
    run: async (fn: any, args: Row) => {
      const before = structuredClone(rows);
      try { return await fn._handler({ db }, { brainInstanceId: "brain:b", ...args }); }
      catch (error) { rows = before; throw error; }
    },
  };
}
const now = 100 * WINDOW_MS;
afterEach(() => vi.restoreAllMocks());
function setup() { vi.spyOn(Date, "now").mockReturnValue(now); return fixture(); }
const statusArgs = (source: string, runId: string, operation: string, extra: Row = {}) => ({
  harness: "test", status: operation === "finish" ? "completed" : "running", sourceSystemsChecked: [source],
  metadata: { role: "agenda", ingestion: { source, runId, operation, ...extra } },
});
const finish = (token: string, accepted = 0) => ({ token, paginationComplete: true, persistenceComplete: true,
  counts: { read: accepted, accepted, ignored: 0 } });
const object = (source: string, token: string, key = "message-1/action-a") => ({
  candidateEntityType: "note", candidatePayload: { title: "A durable note", body: "Evidence" }, rubricDecision: "Useful context",
  sourceRefs: [{ sourceSystem: source, messageId: "message-1" }], ingestion: { source, token, objectKey: key },
});

describe("durable source ingestion", () => {
  // Synthetic provider identities: these validate persistence, not connector discovery.
  it.each(["gmail:fixture", "messages:fixture", "calendar:fixture", "quick_capture:fixture"])(
    "%s reconciles exact item identities across cycles, interruption and replay", async source => {
      const f = setup();
      const persisted = new Map<string, string>();
      const write = async (token: string, id: string) => {
        const result = await f.run(ingestObject, {
          ...object(source, token, `${id}/reference`),
          candidatePayload: { title: `Reference ${id}`, body: `Evidence ${id}` },
          sourceRefs: [{ sourceSystem: source, externalId: id, messageId: id, threadId: "existing-thread" }],
        });
        if (persisted.has(id)) expect(result.entityId).toBe(persisted.get(id));
        persisted.set(id, result.entityId);
      };
      const first = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-1", "claim"));
      await write(first.token, "item-1");
      await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-1", "finish", finish(first.token, 1)));
      vi.mocked(Date.now).mockReturnValue(now + 60 * 60_000);
      const second = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-2", "claim"));
      expect(second.windowStart).toBe(now - OVERLAP_MS);
      await write(second.token, "item-1");
      await write(second.token, "item-2"); // New message, same existing thread.
      const failed = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-2", "finish", {
        ...finish(second.token, 2), persistenceComplete: false,
      }));
      expect(failed.coveredThrough).toBe(now);
      vi.mocked(Date.now).mockReturnValue(now + 2 * 60 * 60_000);
      const recovery = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-3", "claim"));
      expect([recovery.windowStart, recovery.windowEnd]).toEqual([second.windowStart, second.windowEnd]);
      await write(recovery.token, "item-1");
      await write(recovery.token, "item-2");
      const recovered = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-3", "finish", finish(recovery.token, 2)));
      expect(recovered.coveredThrough).toBe(second.windowEnd);
      expect(recovered.caughtUp).toBe(false);
      const catchup = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-3", "claim"));
      await write(catchup.token, "item-2");
      const done = await f.run(updateSourceSyncStatus, statusArgs(source, "cycle-3", "finish", finish(catchup.token, 1)));
      expect(done.caughtUp).toBe(true);
      const refs = f.rows().filter(r => r._id.startsWith("sourceRefs:"));
      expect(refs.map(r => r.externalId).sort()).toEqual(["item-1", "item-2"]);
      expect(refs.every(r => r.threadId === "existing-thread")).toBe(true);
      expect(f.rows().filter(r => r._id.startsWith("knowledge:")).map(r => r._id).sort())
        .toEqual([...persisted.values()].sort());
      expect(f.rows().filter(r => r._id.startsWith("ingestionReceipts:"))).toHaveLength(2);
    });

  it("recovers a capture write before acknowledgement without duplicating or touching hold", async () => {
    const f = setup();
    const hold = await f.db.insert("quickCaptures", { brainInstanceId: "brain:b", status: "pending", intent: "hold", text: "Transfer", createdAt: now });
    const capture = await f.db.insert("quickCaptures", { brainInstanceId: "brain:b", status: "pending", intent: "remember", text: "Reference", createdAt: now });
    const source = "quick_capture:fixture";
    const first = await f.run(updateSourceSyncStatus, statusArgs(source, "before-crash", "claim"));
    const args = object(source, first.token, `${capture}/reference`);
    args.sourceRefs = [{ sourceSystem: source, messageId: capture }];
    const saved = await f.run(ingestObject, args);
    expect((await f.db.get(capture)).status).toBe("pending");
    vi.mocked(Date.now).mockReturnValue(now + LEASE_MS + 1);
    const retry = await f.run(updateSourceSyncStatus, statusArgs(source, "after-crash", "claim"));
    const replay = await f.run(ingestObject, { ...args, ingestion: { ...args.ingestion, token: retry.token } });
    expect(replay.entityId).toBe(saved.entityId);
    await f.run(markQuickCaptureHandledForBrain, { captureId: capture, outcome: "processed", relatedEntityRefs: [{ entityType: "note", entityId: saved.entityId }] });
    expect((await f.db.get(capture)).status).toBe("processed");
    expect((await f.db.get(hold)).status).toBe("pending");
    expect(await f.run(listQuickCapturesForBrain, { status: "pending" })).toEqual([]);
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(1);
  });

  it("replays unknown write responses without duplicate entities or provenance, preserving edits", async () => {
    const f = setup();
    const claim = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "run1", "claim"));
    const first = await f.run(ingestObject, object("gmail:a", claim.token));
    await f.db.patch(first.entityId, { title: "User edit", processingState: "archived" });
    const replay = await f.run(ingestObject, object("gmail:a", claim.token));
    expect(replay.entityId).toBe(first.entityId);
    expect(await f.db.get(first.entityId)).toMatchObject({ title: "User edit", processingState: "archived" });
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(1);
    expect(f.rows().filter(r => r._id.startsWith("sourceRefs:"))).toHaveLength(1);
    // A second semantic output from the same message remains distinct.
    await f.run(ingestObject, object("gmail:a", claim.token, "message-1/action-b"));
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(2);
  });

  it("deduplicates durable memories with the same transactional receipt", async () => {
    const f = setup();
    const c = await f.run(updateSourceSyncStatus, statusArgs("messages:a", "r", "claim"));
    const args = { content: "A stable preference", rubricDecision: "Durable context",
      ingestion: { source: "messages:a", token: c.token, objectKey: "message/preference" } };
    const first = await f.run(recordMemoryForBrain, args);
    const replay = await f.run(recordMemoryForBrain, args);
    expect(replay.memoryId).toBe(first.memoryId);
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(1);
  });

  it("rolls back the accepted entity when receipt persistence fails, then safely retries", async () => {
    const f = setup();
    const c = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r", "claim"));
    f.fail("ingestionReceipts");
    await expect(f.run(ingestObject, object("gmail:a", c.token))).rejects.toThrow("persistence failure");
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(0);
    f.fail("");
    await f.run(ingestObject, object("gmail:a", c.token));
    await f.run(ingestObject, object("gmail:a", c.token));
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(1);
  });

  it("fences concurrent and expired workers, preserving failed windows on takeover", async () => {
    const f = setup();
    const c = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r1", "claim"));
    await expect(f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r2", "claim"))).rejects.toThrow("already claimed");
    expect((await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r1", "claim"))).token).toBe(c.token);
    vi.mocked(Date.now).mockReturnValue(now + LEASE_MS + 1);
    const c2 = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r2", "claim"));
    expect(c2.token).not.toBe(c.token);
    expect([c2.windowStart, c2.windowEnd]).toEqual([c.windowStart, c.windowEnd]);
    await expect(f.run(ingestObject, object("gmail:a", c.token))).rejects.toThrow("Stale ingestion lease");
    await expect(f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r1", "finish", finish(c.token)))).rejects.toThrow("Stale ingestion lease");
  });

  it("does not advance on partial pagination, persists independent success and rejects incomplete aggregate", async () => {
    const f = setup();
    const a = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r", "claim"));
    const b = await f.run(updateSourceSyncStatus, statusArgs("messages:a", "r", "claim"));
    await f.run(ingestObject, object("gmail:a", a.token));
    const failed = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r", "finish", { ...finish(a.token, 1), paginationComplete: false }));
    expect(failed.status).toBe("failed"); expect(failed.coveredThrough).toBeUndefined();
    const success = await f.run(updateSourceSyncStatus, statusArgs("messages:a", "r", "finish", finish(b.token)));
    expect(success.lastSuccessAt).toBe(now); expect(success.coveredThrough).toBe(now);
    const aggregate = { harness: "test", status: "completed", sourceSystemsChecked: ["gmail:a", "messages:a"], metadata: { role: "agenda", ingestion: { runId: "r" } } };
    await f.run(recordIngestionRun, { ...aggregate, status: "running" });
    await expect(f.run(recordIngestionRun, aggregate)).rejects.toThrow("gmail:a");
    await expect(f.run(recordIngestionRun, { ...aggregate, sourceSystemsChecked: ["messages:a"] })).rejects.toThrow("scope cannot change");
    const retry = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r", "claim"));
    expect(retry.windowStart).toBe(a.windowStart);
    await f.run(ingestObject, object("gmail:a", retry.token));
    await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r", "finish", finish(retry.token, 1)));
    await f.run(recordIngestionRun, aggregate);
    await expect(f.run(recordIngestionRun, { ...aggregate, sourceSystemsChecked: [...aggregate.sourceSystemsChecked, "calendar:a"] })).rejects.toThrow("scope cannot change");
    expect(f.rows().filter(r => r._id.startsWith("knowledge:"))).toHaveLength(1);
  });

  it("catches up oldest-first with overlap, never clipping an outage to the recent floor", async () => {
    const f = setup();
    const c = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r1", "claim"));
    await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r1", "finish", finish(c.token)));
    vi.mocked(Date.now).mockReturnValue(now + 5 * WINDOW_MS);
    const next = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r2", "claim"));
    expect(next.windowStart).toBe(now - OVERLAP_MS);
    expect(next.windowEnd).toBe(next.windowStart + WINDOW_MS);
    const done = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r2", "finish", finish(next.token)));
    expect(done.caughtUp).toBe(false);
    const again = await f.run(updateSourceSyncStatus, statusArgs("gmail:a", "r2", "claim"));
    expect(again.windowStart).toBe(done.coveredThrough - OVERLAP_MS);
    expect(again.lastSuccessAt).toBe(now + 5 * WINDOW_MS);
  });

  it("fences concurrent mirror passes and retains the frozen full-sync window after failure", async () => {
    const f = setup();
    const args = { hostToken: "host", calendarId: "a" };
    const c = await f.run(hostClaimCalendarSync, args);
    await expect(f.run(hostClaimCalendarSync, args)).rejects.toThrow("already claimed");
    vi.mocked(Date.now).mockReturnValue(now + LEASE_MS + 1);
    const retry = await f.run(hostClaimCalendarSync, args);
    expect(retry.windowAnchor).toBe(c.windowAnchor);
    await expect(f.run(hostUpsertCalendarEvents, { ...args, claimToken: c.claimToken, events: [] })).rejects.toThrow("Stale calendar");
    await expect(f.run(hostRecordCalendarSyncToken, { ...args, claimToken: c.claimToken, syncToken: "bad", status: "completed" })).rejects.toThrow("Stale calendar");
    await f.run(hostRecordCalendarSyncToken, { ...args, claimToken: retry.claimToken, syncToken: null, status: "failed", errors: ["page two failed"] });
    const third = await f.run(hostClaimCalendarSync, args);
    expect(third.windowAnchor).toBe(c.windowAnchor);
    await f.run(hostRecordCalendarSyncToken, { ...args, claimToken: third.claimToken, syncToken: "good", status: "completed" });
    const fourth = await f.run(hostClaimCalendarSync, args);
    expect(fourth.syncToken).toBe("good");
    await f.run(hostRecordCalendarSyncToken, { ...args, claimToken: fourth.claimToken, syncToken: null, status: "failed" });
    const row = f.rows().find(r => r.statusKey === "google_calendar:a")!;
    expect(row.metadata.syncToken).toBe("good");
    expect(row.metadata.lastSuccessAt).toBe(now + LEASE_MS + 1);
  });

  it("keeps calendar edits, instances, cancellation tombstones and separate calendars stable", async () => {
    const f = setup();
    const event = { id: "instance-1", summary: "Weekly meeting", recurringEventId: "series", originalStartTime: { dateTime: "2026-11-01T12:00:00Z" }, start: { dateTime: "2026-11-01T12:00:00Z" }, end: { dateTime: "2026-11-01T13:00:00Z" } };
    await f.run(upsertCalendarEvents, { calendarId: "a", events: [event, { ...event, id: "instance-2" }] });
    await f.run(upsertCalendarEvents, { calendarId: "b", events: [event] });
    await f.run(upsertCalendarEvents, { calendarId: "a", events: [{ ...event, summary: "Renamed", start: { dateTime: "2026-11-02T12:00:00Z" } }] });
    await f.run(upsertCalendarEvents, { calendarId: "a", events: [{ id: "instance-1", status: "cancelled" }] });
    await f.run(upsertCalendarEvents, { calendarId: "a", events: [{ id: "instance-1", status: "cancelled" }] });
    const events = f.rows().filter(r => r._id.startsWith("calendarEvents:"));
    expect(events).toHaveLength(3);
    expect(events.find(r => r.calendarId === "a" && r.externalId === "instance-1")).toMatchObject({ title: "Renamed", status: "cancelled", recurringEventId: "series", originalStartAt: Date.parse("2026-11-01T12:00:00Z") });
    expect(events.find(r => r.calendarId === "b")?.status).toBe("confirmed");
  });
});
