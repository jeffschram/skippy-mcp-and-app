import { describe, it, expect, vi } from "vitest";
import { getForViewer, setForViewer, focusForViewer, browseForViewer } from "./attention";

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
const item = (id: string, extra: Row = {}): Row => ({ _id: id, brainInstanceId: "brain:mine", title: id, processingState: "accepted", ...extra });
describe("attention access and persistence", () => {
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
    expect((await run(getForViewer, ctx, { kind: "task", id: row._id, now })).result.status).toBe("ok");
    await run(setForViewer, ctx, { kind: "task", id: row._id, attention: {} });
    expect(row.attention.override).toBeUndefined();
    expect((await run(getForViewer, ctx, { kind: "task", id: row._id, now })).result.status).toBe("todo");
  });
  it("rejects invalid schedules and dates before writing", async () => {
    const ctx = fixture([item("tasks:a")]);
    for (const attention of [{ override: "scheduled" }, { reviewAt: NaN }, { scheduledAt: -1 }, { reason: "x".repeat(501) }]) await expect(run(setForViewer, ctx, { kind: "task", id: "tasks:a", attention })).rejects.toThrow();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
describe("attention focus and browse", () => {
  it("ranks actionable items and excludes archives, completed work, and archived-project tasks", async () => {
    const rows = [
      item("tasks:urgent", { status: "todo", dueAt: now - 1 }),
      item("people:review", { name: "Review contact", attention: { reviewAt: now } }),
      item("tasks:open", { status: "todo" }),
      item("tasks:done", { status: "done", dueAt: now - 1 }),
      item("tasks:hidden", { status: "todo", dueAt: now - 1 }),
      item("projects:archive", { status: "archived" }),
      item("relationships:parent", { type: "belongs_to", from: { entityType: "task", entityId: "tasks:hidden" }, to: { entityType: "project", entityId: "projects:archive" } }),
      item("people:other", { brainInstanceId: "brain:other", attention: { override: "immediate" } }),
    ];
    const ctx = fixture(rows);
    const focus = await run(focusForViewer, ctx, { now });
    expect(focus.items.map((row: Row) => row.id)).toEqual(["tasks:urgent", "people:review", "tasks:open"]);
    const browse = await run(browseForViewer, ctx, { kind: "task", now, paginationOpts: { numItems: 25, cursor: null } });
    expect(browse.page.map((row: Row) => row.id)).toEqual(["tasks:urgent", "tasks:open", "tasks:done"]);
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
  expect(result.taskStatus).toBe("todo");
  expect(result.sources).toEqual([{ label: "Open source email", href: "https://mail.google.com/mail/u/0/#all/18abc123456789ab" }]);
});
