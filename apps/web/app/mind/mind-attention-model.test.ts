import { describe, it, expect } from "vitest";
import { mindAttentionRows, todayRange, type FocusItem, type ReviewItem } from "./mind-attention-model";
const now = new Date(2026, 8, 17, 10).getTime();
const task: FocusItem = { id: "task", title: "Call", kind: "task", result: { status: "immediate", reason: "Overdue", source: "automatic" } };
const review: ReviewItem = { id: "decision", entityId: "task", title: "Call", reason: "Awaiting approval", type: "approval" };
describe("Mind consolidated attention", () => {
  it("merges schedule and attention by identity and keeps the urgent reason", () => {
    const rows = mindAttentionRows([task], [{ id: "task", source: "task", title: "Call", at: now + 1000 }], [], now, "");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.group).toBe("needs");
    expect(rows[0]?.reason).toContain("Overdue");
    expect(rows[0]?.agenda?.source).toBe("task");
  });
  it("keeps multiple decisions accessible in one entity row", () => {
    const rows = mindAttentionRows([task], [], [review, { ...review, id: "second", type: "triage" }], now, "");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviews).toHaveLength(2);
    expect(rows[0]?.group).toBe("needs");
  });
  it("does not merge unrelated records merely because their titles match", () => {
    expect(mindAttentionRows([task], [], [{ ...review, entityId: "different" }], now, "")).toHaveLength(2);
  });
  it("excludes projects, past events and tomorrow while retaining ongoing events", () => {
    const { from, to } = todayRange(now);
    const rows = mindAttentionRows([{ ...task, kind: "project" }], [
      { id: "past", source: "event", title: "Past", at: from + 1, endAt: now - 1 },
      { id: "live", source: "event", title: "Live", at: now - 1000, endAt: now + 1000 },
      { id: "tomorrow", source: "event", title: "Tomorrow", at: to + 1 },
    ], [], now, "");
    expect(rows.map(row => row.title)).toEqual(["Live"]);
  });
  it("keeps suggestions separate from undated commitments and searches reasons", () => {
    const rows = mindAttentionRows([{ ...task, result: { ...task.result, status: "todo" } }], [], [{ ...review, entityId: "memory", type: "memory" }], now, "");
    expect(rows.map(row => row.group).sort()).toEqual(["next", "review"]);
    expect(mindAttentionRows([], [], [review], now, "approval")).toHaveLength(1);
  });
});
