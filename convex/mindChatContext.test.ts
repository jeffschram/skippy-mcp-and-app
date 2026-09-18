import { describe, expect, it } from "vitest";
import { mindChatContext, validateMindChatScope } from "./mindChatContext";
function fixture(rows: any[]) {
  return {
    normalizeId: (table: string, id: string) => id.startsWith(table + ":") ? id : null,
    get: async (id: string) => rows.find(row => row._id === id) ?? null,
    query: (table: string) => {
      let matches = rows.filter(row => row._id.startsWith(table + ":"));
      const range = { eq: (field: string, value: unknown): any => {
        matches = matches.filter(row => field.split(".").reduce((v, key) => v?.[key], row) === value);
        return range;
      } };
      return { withIndex: (_: string, fn: any) => { fn(range); return { take: async (n: number) => matches.slice(0, n) }; } };
    },
  } as any;
}
const brain = "brain:mine" as any;
const task = { _id: "tasks:a", brainInstanceId: brain, title: "Renew subscription?", status: "todo" };
describe("Mind card chat context", () => {
  it("rejects foreign, deleted and unsupported records on send", async () => {
    const db = fixture([{ ...task, brainInstanceId: "other" }]);
    for (const id of ["tasks:a", "tasks:missing", "users:private"]) {
      await expect(validateMindChatScope(db, brain, "mind-item:" + id)).rejects.toThrow("no longer available");
    }
  });
  it("refreshes status and preserves the stable record identity", async () => {
    const row = { ...task };
    const db = fixture([row]);
    expect(await mindChatContext(db, brain, "mind-item:tasks:a")).toContain('"status":"todo"');
    row.status = "done";
    const context = await mindChatContext(db, brain, "mind-item:tasks:a");
    expect(context).toContain('"status":"done"');
    expect(context).toContain('"id":"tasks:a"');
    expect(context).toContain("A chat transcript alone is not a memory update");
  });
  it("includes owned relationships and sources but excludes foreign endpoints", async () => {
    const db = fixture([task,
      { _id: "projects:p", brainInstanceId: brain, title: "Budget" },
      { _id: "people:x", brainInstanceId: "other", name: "PRIVATE" },
      ...["projects:p", "people:x"].map((id, i) => ({ _id: `relationships:${i}`, brainInstanceId: brain, type: "related_to", from: { entityId: task._id }, to: { entityId: id } })),
      { _id: "entitySourceRefs:s", brainInstanceId: brain, entityRef: { entityType: "task", entityId: task._id }, sourceRefId: "sourceRefs:s" },
      { _id: "sourceRefs:s", brainInstanceId: brain, sourceSystem: "email", url: "https://example.com/source" },
    ]);
    const context = await mindChatContext(db, brain, "mind-item:tasks:a");
    expect(context).toContain("Budget"); expect(context).toContain("https://example.com/source");
    expect(context).not.toContain("PRIVATE"); expect(context).not.toContain("people:x");
  });
  it("supports collections and leaves existing chat scopes unchanged", async () => {
    const db = fixture([]);
    expect(await mindChatContext(db, brain, "mind")).toBeNull();
    expect(await mindChatContext(db, brain, "mind-item:category:person")).toContain("person collection");
    await expect(validateMindChatScope(db, brain, "mind-item:owner:self")).resolves.toBeUndefined();
    await expect(validateMindChatScope(db, brain, "mind-item:category:invented")).rejects.toThrow();
  });
});
