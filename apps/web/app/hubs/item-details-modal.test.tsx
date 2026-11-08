import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useQuery } from "convex/react";
import { ItemDetailsModal } from "./item-details-modal";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));
vi.mock("../components", () => ({ Button: () => null, LoadingRow: () => <p>Loading item…</p> }));
vi.mock("../components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? children : null,
  DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("../components/chat-panel", () => ({
  ItemDetailsChat: ({ kind, id }: { kind: string; id: string }) => <div data-chat={`${kind}:${id}`} />,
}));
const selection = { kind: "task" as const, id: "canonical-a" };
function render(detail: any, selected = selection) {
  vi.mocked(useQuery).mockReturnValue(detail);
  return renderToStaticMarkup(createElement(ItemDetailsModal, { selection: selected, onClose: () => {}, opener: { current: null } }));
}
const detail = {
  row: { kind: "task", id: "canonical-a", title: "Canonical title", status: "done", isAllDay: false },
  description: "Saved description", dates: [], timeZone: null, recurrence: "Every 3 days", projectId: null,
  sources: [{ label: "Safe source", url: "https://example.com" }, { label: "Unsafe source", url: "javascript:alert(1)" }],
};

describe("item details", () => {
  it("queries the selected entity and passes canonical identity to chat", () => {
    const html = render(detail);
    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[1]).toEqual(selection);
    expect(html).toContain('data-chat="task:canonical-a"');
    expect(html).toContain("Canonical title");
    expect(html).toContain("Saved description");
    expect(html).toContain("Every 3 days");
    expect(html).toContain("Safe source");
    expect(html).not.toContain("Unsafe source");
    const next = render({ ...detail, row: { ...detail.row, id: "canonical-b", title: "Other item" } }, { kind: "task", id: "canonical-b" });
    expect(next).toContain('data-chat="task:canonical-b"');
    expect(next).not.toContain("canonical-a");
  });
  it("does not mount chat while loading or after deletion/access loss", () => {
    expect(render(undefined)).toContain("Loading item");
    expect(render(undefined)).not.toContain("data-chat");
    expect(render(null)).toContain("This item is unavailable");
    expect(render(null)).not.toContain("data-chat");
  });
});
