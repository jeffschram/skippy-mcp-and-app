import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeItemRow } from "./life-tasks";
vi.mock("@/lib/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
vi.mock("../components", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
  IconButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
const props = { now: 1000, onOpen: vi.fn(), onComplete: vi.fn(), onPause: vi.fn(), onNudge: vi.fn() };
describe("shared Home row", () => {
  it("keeps the title and completion as sibling buttons with touch-sized wrapping controls", () => {
    const html = renderToStaticMarkup(<HomeItemRow {...props} row={{ kind: "task", id: "a", title: "Long task title", status: "todo" }} />);
    expect(html).toContain('aria-label="Complete Long task title"');
    expect(html).toContain("min-h-11"); expect(html).toContain("overflow-wrap:anywhere");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*>[^]*?<button[^]*?<\/button>[^]*?<\/button>/);
  });
  it("renders review and resolved task attention badges without review completion", () => {
    const result = { status: "stale" as const, reason: "Review date arrived", source: "automatic" as const };
    const review = renderToStaticMarkup(<HomeItemRow {...props} row={{ kind: "review", entityKind: "person", id: "p", title: "Person", attentionResult: result }} />);
    expect(review).toContain("Needs review"); expect(review).not.toContain('aria-label="Complete');
    const task = renderToStaticMarkup(<HomeItemRow {...props} row={{ kind: "task", id: "t", title: "Task", attentionResult: { ...result, status: "immediate" } }} />);
    expect(task).toContain("Needs immediate attention");
  });
  it("never offers event completion and disables completed task completion", () => {
    const event = renderToStaticMarkup(<HomeItemRow {...props} row={{ kind: "event", id: "e", title: "Event" }} />);
    expect(event).not.toContain('aria-label="Complete'); expect(event.match(/<button/g)).toHaveLength(1);
    const done = renderToStaticMarkup(<HomeItemRow {...props} row={{ kind: "task", id: "t", title: "Done", status: "done" }} />);
    expect(done).toContain('disabled=""');
  });
});
