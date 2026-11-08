import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeActionsProvider, HomeItemActions } from "./home-item-actions";
import { safeExternalUrl } from "./item-action-helpers";
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("../components", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
const row = { kind: "task", id: "task", title: "Filter", status: "todo" };
function render(item: any, details = true) { return renderToStaticMarkup(<HomeActionsProvider><HomeItemActions row={item} details={details} /></HomeActionsProvider>); }
describe("shared action capabilities", () => {
  it("omits every mutation control for events and terminal tasks", () => {
    expect(render({ ...row, kind: "event" })).toBe("");
    expect(render({ ...row, status: "done" })).not.toContain("<button");
    expect(render({ ...row, status: "cancelled" })).not.toContain("<button");
    expect(render({ ...row, recurrenceId: "repeat", recurrenceStatus: "retired" })).not.toContain("<button");
  });
  it("keeps completion directly available and secondary actions in details", () => {
    expect(render(row, false).match(/<button/g)).toHaveLength(1);
    expect(render(row)).toContain("Cancel task");
    const repeated = render({ ...row, recurrenceId: "repeat", recurrenceStatus: "paused", occurrenceVersion: 2 });
    expect(repeated).toContain("Log completion"); expect(repeated).toContain("Skip occurrence"); expect(repeated).toContain("Resume repeat");
    expect(repeated).not.toContain("Cancel task");
  });
  it("offers review transitions in both rows and details without lifecycle controls", () => {
    for (const details of [false, true]) {
      const html = render({ kind: "review", entityKind: "project", id: "p", title: "Project" }, details);
      expect(html).toContain("Done reviewing"); expect(html).toContain("Later");
      expect(html).not.toContain("Complete"); expect(html).not.toContain("Cancel task");
    }
  });
  it("allows only valid HTTP(S) sources without embedded credentials", () => {
    for (const url of ["javascript:alert(1)", "https://", "file:///tmp/a", "https://user:pass@example.com"]) expect(safeExternalUrl(url)).toBe(false);
    expect(safeExternalUrl("https://calendar.google.com/calendar/event?eid=a")).toBe(true);
    expect(safeExternalUrl("https://meet.google.com/abc-defg-hij")).toBe(true);
  });
});
