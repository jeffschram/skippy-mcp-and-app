import { describe, expect, it } from "vitest";
import { mindChatContext, validateMindChatScope } from "./mindChatContext";

function fixture() {
  const records: Record<string, any> = {
    "tasks:a": { _id: "tasks:a", brainInstanceId: "mine", title: "Task A", status: "todo" },
    "calendarEvents:b": { _id: "calendarEvents:b", brainInstanceId: "mine", title: "Event B", startAt: 123, endAt: 456 },
    "recurrences:c": { _id: "recurrences:c", brainInstanceId: "mine", title: "Repeat C", rule: { kind: "interval", everyDays: 7 }, anchor: "completion" },
    "tasks:foreign": { _id: "tasks:foreign", brainInstanceId: "other", title: "Private" },
  };
  const db = {
    normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
    get: async (id: string) => records[id] ?? null,
    query: () => ({ withIndex: () => ({ take: async () => [], first: async () => null }) }),
  };
  return { records, db: db as any, brain: "mine" as any };
}

describe("entity detail chat context", () => {
  it("resolves the selected canonical type and ID without including another item", async () => {
    const { db, brain } = fixture();
    for (const [kind, id, title] of [["task", "tasks:a", "Task A"], ["event", "calendarEvents:b", "Event B"], ["recurrence", "recurrences:c", "Repeat C"]]) {
      const key = `mind-item:${id}`;
      await expect(validateMindChatScope(db, brain, key)).resolves.toBeUndefined();
      const context = await mindChatContext(db, brain, key);
      expect(context).toContain(`"id":"${id}"`);
      expect(context).toContain(title);
      expect(context).not.toContain("Private");
      if (kind !== "task") expect(context).not.toContain("Task A");
      if (kind === "recurrence") expect(context).toContain('"everyDays":7');
    }
  });
  it("rejects foreign, malformed and deleted records", async () => {
    const { db, brain, records } = fixture();
    delete records["tasks:a"];
    for (const key of ["mind-item:tasks:foreign", "mind-item:bad", "mind-item:tasks:a"]) {
      await expect(validateMindChatScope(db, brain, key)).rejects.toThrow("no longer available");
      expect(await mindChatContext(db, brain, key)).toContain("Do not infer or modify a replacement");
    }
  });
  it("refreshes canonical context each turn and preserves existing Mind keys", async () => {
    const { db, brain, records } = fixture();
    expect(await mindChatContext(db, brain, "mind-item:tasks:a")).toContain("Task A");
    records["tasks:a"].title = "Updated title";
    expect(await mindChatContext(db, brain, "mind-item:tasks:a")).toContain("Updated title");
    expect(await mindChatContext(db, brain, "home")).toBeNull();
  });
});
