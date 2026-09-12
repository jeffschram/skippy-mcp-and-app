import { describe, it, expect } from "vitest";
import { resolveAttention, isAttentionArchived, taskSourceLinks, completedTaskAttention } from "./attentionModel";
const now = 1_800_000_000_000;
describe("shared attention rules", () => {
  it("does not treat old or accepted reference material as stale or OK", () => {
    for (const kind of ["memory", "note", "link", "knowledgeObject", "person", "company", "goal", "project"] as const) expect(resolveAttention(kind, { status: "accepted" }, now).status).toBe("unassessed");
  });
  it("derives open tasks without mistaking future deadlines for schedules", () => {
    expect(resolveAttention("task", { status: "todo", dueAt: now + 1000 }, now).status).toBe("todo");
    expect(resolveAttention("task", { status: "waiting" }, now).reason).toMatch(/follow-up/);
  });
  it("makes overdue obligations urgent at the boundary but does not make wants overdue", () => {
    expect(resolveAttention("task", { status: "todo", dueAt: now }, now).status).toBe("immediate");
    expect(resolveAttention("task", { status: "todo", dueAt: now, commitment: "want" }, now).status).toBe("todo");
  });
  it("does not keep completed or cancelled work urgent", () => {
    for (const status of ["done", "cancelled"]) expect(resolveAttention("task", { status, dueAt: now - 1, executionState: "blocked" }, now).status).toBe("ok");
    expect(resolveAttention("project", { status: "completed" }, now).status).toBe("ok");
  });
  it("honors deliberate manual overrides", () => {
    expect(resolveAttention("task", { status: "todo", dueAt: now - 1, attention: { override: "ok", reason: "Handled elsewhere" } }, now)).toEqual({ status: "ok", reason: "Handled elsewhere", source: "manual" });
  });
  it("resurfaces a manual assessment at its review time", () => {
    const row = { attention: { override: "ok" as const, reviewAt: now } };
    expect(resolveAttention("person", row, now - 1).status).toBe("ok");
    expect(resolveAttention("person", row, now).status).toBe("stale");
    expect(resolveAttention("person", { attention: { override: "immediate", reviewAt: now } }, now).status).toBe("immediate");
  });
  it("recognizes explicit schedules and resurfaces missed outcomes", () => {
    expect(resolveAttention("note", { attention: { scheduledAt: now + 1 } }, now).status).toBe("scheduled");
    expect(resolveAttention("note", { attention: { scheduledAt: now } }, now).status).toBe("stale");
    expect(resolveAttention("task", { status: "done", attention: { scheduledAt: now - 1 } }, now).status).toBe("ok");
  });
  it("does not let a future schedule conceal an overdue obligation", () => {
    expect(resolveAttention("task", { status: "todo", dueAt: now - 1, attention: { override: "scheduled", scheduledAt: now + 1 } }, now).status).toBe("immediate");
  });
  it("excludes archives across lifecycle axes", () => {
    expect(isAttentionArchived({ processingState: "archived" })).toBe(true);
    expect(isAttentionArchived({ reviewState: "archived" })).toBe(true);
    expect(isAttentionArchived({ status: "archived" })).toBe(true);
    expect(isAttentionArchived({ status: "done" })).toBe(false);
  });
});


describe("task source links and completion", () => {
  it("retains source email and action URLs while deduplicating", () => {
    expect(taskSourceLinks({ sourceSystem: "gmail", deepLink: "https://mail.google.com/mail/u/0/#all/abc", url: "https://www.canva.com/invite/example" })).toHaveLength(2);
    expect(taskSourceLinks({ sourceSystem: "web", deepLink: "https://example.com/", url: "https://example.com/" })).toHaveLength(1);
  });
  it("rejects executable, malformed, and credential-bearing URLs", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "not a url", "https://user:password@example.com/"]) expect(taskSourceLinks({ sourceSystem: "web", url })).toEqual([]);
  });
  it("only builds Gmail fallback links from recognized stored identifiers", () => {
    expect(taskSourceLinks({ sourceSystem: "gmail", threadId: "18abc123456789ab" })[0]?.href).toBe("https://mail.google.com/mail/u/0/#all/18abc123456789ab");
    expect(taskSourceLinks({ sourceSystem: "gmail", messageId: "<message@example.com>" })).toEqual([]);
    expect(taskSourceLinks({ sourceSystem: "web", threadId: "18abc123456789ab" })).toEqual([]);
  });
  it("completion clears stale reviews, schedules and urgency without losing the saved explanation", () => {
    const attention = completedTaskAttention({ override: "immediate", reviewAt: now - 1, scheduledAt: now - 1, reason: "Invite from Holly" }, now);
    expect(attention).toEqual({ reason: "Invite from Holly", assessedAt: now });
    expect(resolveAttention("task", { status: "done", attention, dueAt: now - 1 }, now).status).toBe("ok");
  });
});
