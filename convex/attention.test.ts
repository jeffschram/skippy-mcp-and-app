import { describe, it, expect, vi } from "vitest";
import { setForViewer, eligible } from "./attention";
import { getForViewer } from "./homeInventory";

type Row = Record<string, any>;
function fixture(rows: Row[], signedIn = true) {
  const db = {
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    get: vi.fn(async (id: string) => rows.find(row => row._id === id) || null),
    patch: vi.fn(async (id: string, patch: Row) => Object.assign(rows.find(row => row._id === id)!, patch)),
    query: (table: string) => {
      let matches = rows.filter(row => row._id.startsWith(`${table}:`));
      const field = (row: Row, path: string): unknown => path.split(".").reduce<unknown>((value, key) =>
        value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
      const range: Row = {};
      for (const op of ["eq", "gt", "lte"]) range[op] = (key: string, value: unknown) => {
        matches = matches.filter(row => {
          const actual = field(row, key);
          if (op === "eq") return actual === value;
          if (typeof actual !== "number" || typeof value !== "number") return false;
          return op === "gt" ? actual > value : actual <= value;
        });
        return range;
      };
      const chain = {
        filter: () => chain,
        unique: async () => ({ _id: "users:me" }),
        first: async () => table === "brainInstances" ? ({ _id: "brain:mine" }) : matches[0] ?? null,
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
const item = (id: string, extra: Row = {}): Row => ({ _id: id, brainInstanceId: "brain:mine", title: id, processingState: "accepted", ...extra });
describe("attention access and persistence", () => {
  it("saves In Progress without changing lifecycle and restores Automatic", async () => {
    const row = item("projects:active", { status: "planned" });
    const ctx = fixture([row]);
    await run(setForViewer, ctx, { kind: "project", id: row._id, attention: { override: "in_progress" } });
    expect(row.status).toBe("planned");
    expect((await run(getForViewer, ctx, { kind: "review", id: row._id, now })).row.attentionResult.status).toBe("in_progress");
    await run(setForViewer, ctx, { kind: "project", id: row._id, attention: {} });
    expect((await run(getForViewer, ctx, { kind: "review", id: row._id, now })).row.attentionResult.status).toBe("unassessed");
  });
  it("requires sign-in", async () => {
    await expect(run(getForViewer, fixture([], false), { kind: "task", id: "tasks:a", now })).rejects.toThrow("authentication required");
  });
  it("does not read or mutate another brain's records", async () => {
    const ctx = fixture([item("tasks:a", { brainInstanceId: "brain:other" })]);
    expect(await run(getForViewer, ctx, { kind: "task", id: "tasks:a", now })).toBeNull();
    await expect(run(setForViewer, ctx, { kind: "task", id: "tasks:a", attention: { override: "ok" } })).rejects.toThrow("Item not found");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it("validates table IDs and canonical knowledge kinds", async () => {
    const ctx = fixture([item("knowledge:a", { kind: "memory" })]);
    for (const kind of ["task", "note"]) await expect(run(setForViewer, ctx, { kind, id: "knowledge:a", attention: {} })).rejects.toThrow("Item not found");
  });
  it("persists user assessment and clears old metadata when returning to Automatic", async () => {
    const row = item("tasks:a", { status: "todo" }); const ctx = fixture([row]);
    await run(setForViewer, ctx, { kind: "task", id: row._id, attention: { override: "ok", reason: "  Handled  " } });
    expect(row.attention.reason).toBe("Handled");
    expect((await run(getForViewer, ctx, { kind: "task", id: row._id, now })).row.attentionResult.status).toBe("ok");
    await run(setForViewer, ctx, { kind: "task", id: row._id, attention: {} });
    expect(row.attention.override).toBeUndefined();
    expect((await run(getForViewer, ctx, { kind: "task", id: row._id, now })).row.attentionResult.status).toBe("todo");
  });
  it("rejects invalid schedules and dates before writing", async () => {
    const ctx = fixture([item("tasks:a")]);
    for (const attention of [{ override: "scheduled" }, { reviewAt: NaN }, { scheduledAt: -1 }, { reason: "x".repeat(501) }]) await expect(run(setForViewer, ctx, { kind: "task", id: "tasks:a", attention })).rejects.toThrow();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
describe("review transitions", () => {
  it("acknowledges without changing lifecycle and preserves the latest reason", async () => {
    const row = item("projects:a", { status: "in_progress", attention: { override: "immediate", reviewAt: 0, scheduledAt: 1, reason: "Latest context" } });
    const ctx = fixture([row]);
    await run(setForViewer, ctx, { kind: "project", id: row._id, reviewAction: "done", attention: { reason: "Stale context" } });
    expect(row.status).toBe("in_progress");
    expect(row.attention).toEqual({ override: "ok", reason: "Latest context", assessedAt: expect.any(Number) });
    expect((await run(getForViewer, ctx, { kind: "review", id: row._id, now })).row.attentionResult.status).toBe("ok");
    const reviewAt = Date.now() + 100000;
    await run(setForViewer, ctx, { kind: "project", id: row._id, reviewAction: "later", attention: { reviewAt } });
    expect(row.attention).toEqual({ override: "ok", reason: "Latest context", reviewAt, assessedAt: expect.any(Number) });
    vi.spyOn(Date, "now").mockReturnValue(reviewAt);
    expect((await run(getForViewer, ctx, { kind: "review", id: row._id })).row.attentionResult.status).toBe("stale");
    vi.restoreAllMocks();
  });
  it("rejects stale editor saves, past Later times, and task review dates", async () => {
    const row = item("people:a", { attention: { reason: "Changed" } });
    const ctx = fixture([row, item("tasks:a")]);
    await expect(run(setForViewer, ctx, { kind: "person", id: row._id, attention: {}, expectedAttention: {} })).rejects.toThrow("Attention changed");
    await expect(run(setForViewer, ctx, { kind: "person", id: row._id, attention: { reviewAt: 0 }, reviewAction: "later" })).rejects.toThrow("future");
    await expect(run(setForViewer, ctx, { kind: "task", id: "tasks:a", attention: { reviewAt: Date.now() + 10000 } })).rejects.toThrow("deadlines");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it("retains the shared archived-parent and relationship-budget checks", async () => {
    const task = item("tasks:a");
    const parent = item("projects:p", { status: "archived" });
    const link = item("relationships:l", { type: "belongs_to", from: { entityType: "task", entityId: task._id }, to: { entityType: "project", entityId: parent._id } });
    expect(await eligible(fixture([task, parent, link]) as any, task as any, "task", "brain:mine")).toBe(false);
    expect(await eligible(fixture(Array.from({ length: 65 }, (_, i) => ({ ...link, _id: `relationships:${i}` }))) as any, task as any, "task", "brain:mine")).toBe(false);
  });
});

it("returns only linked sources in the owner's brain", async () => {
  const ctx = fixture([
    item("tasks:invite", { status: "todo" }),
    item("entitySourceRefs:one", { entityRef: { entityType: "task", entityId: "tasks:invite" }, sourceRefId: "sourceRefs:one" }),
    item("entitySourceRefs:foreign", { entityRef: { entityType: "task", entityId: "tasks:invite" }, sourceRefId: "sourceRefs:foreign" }),
    item("entitySourceRefs:other-task", { entityRef: { entityType: "task", entityId: "tasks:other" }, sourceRefId: "sourceRefs:other" }),
    item("sourceRefs:one", { sourceSystem: "gmail", deepLink: "https://mail.google.com/mail/u/0/#all/18abc123456789ab" }),
    item("sourceRefs:foreign", { brainInstanceId: "brain:other", sourceSystem: "web", url: "https://private.example.com/" }),
    item("sourceRefs:other", { sourceSystem: "web", url: "https://unrelated.example.com/" }),
  ]);
  const result = await run(getForViewer, ctx, { kind: "task", id: "tasks:invite", now });
  expect(result.row.status).toBe("todo");
  expect(result.sources).toEqual([{ label: "Open source email", url: "https://mail.google.com/mail/u/0/#all/18abc123456789ab" }]);
});
