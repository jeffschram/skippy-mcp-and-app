import { describe, expect, it } from "vitest";
import { normalizeAcceptedEntityPayload } from "./index";
const now = Date.parse("2026-09-12T12:00:00Z");
const release = Date.parse("2026-09-10T00:00:00Z");
describe("task versus informational event", () => {
  it("rejects declared events and references with useful routing guidance", () => {
    for (const itemIntent of ["event", "reference", "informational"]) expect(() => normalizeAcceptedEntityPayload("task", { title: "Audible pre-order releases: The Infinite Extent", itemIntent, dueAt: release }, now)).toThrow("Save it as a note/reference");
    expect(() => normalizeAcceptedEntityPayload("task", { title: "Book now available", actionRequired: false }, now)).toThrow("informational");
  });
  it("does not turn a start date into a deadline and preserves the date as context", () => {
    const task = normalizeAcceptedEntityPayload("task", { title: "Download the audiobook", start: release }, now);
    expect(task.dueAt).toBeUndefined();
    expect(task.description).toContain("Event date (not a deadline): 2026-09-10");
  });
  it("removes explicitly event-typed deadlines without losing source context", () => {
    const task = normalizeAcceptedEntityPayload("task", { title: "Download the audiobook", description: "Owner requested download", dateKind: "event", dueAt: release }, now);
    expect(task.dueAt).toBeUndefined();
    expect(task.description).toContain("Owner requested download");
    expect(task.description).toContain("2026-09-10");
  });
  it("retains real deadlines even when a task mentions a release or birthday", () => {
    for (const title of ["Release the app", "Buy a birthday gift", "Cancel pre-order before release"]) {
      const task = normalizeAcceptedEntityPayload("task", { title, itemIntent: "action", dateKind: "deadline", dueAt: release }, now);
      expect(task.dueAt).toBe(release);
    }
  });
  it("keeps event and deadline dates distinct when both exist", () => {
    const task = normalizeAcceptedEntityPayload("task", { title: "Prepare for conference", dueAt: now, eventAt: now + 86400000 }, now);
    expect(task.dueAt).toBe(now);
    expect(task.description).toContain("2026-09-13");
  });
  it("accepts informational notes without creating any obligation", () => {
    const note = normalizeAcceptedEntityPayload("note", { title: "Book release", body: "Available September 10", itemIntent: "event" }, now);
    expect(note).toEqual({ title: "Book release", body: "Available September 10" });
  });
});
