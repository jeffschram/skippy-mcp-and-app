import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useQuery } from "convex/react";
import type { AgendaItem } from "@skippy/shared";
import { AgendaSection } from "./agenda";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));
vi.mock("./use-viewer", () => ({ useViewerReady: () => true }));
vi.mock("../components/attention", () => ({ useAttentionClock: () => new Date(2026, 10, 7, 9).getTime() }));
vi.mock("../components", () => ({
  Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  EmptyState: () => <p>Nothing scheduled</p>,
  LoadingRow: () => <p>Loading</p>,
}));

const event = (hour: number, day = 7): AgendaItem => ({
  id: `${day}-${hour}`, source: "event", title: `Unique appointment ${day}-${hour}`,
  at: new Date(2026, 10, day, hour).getTime(),
  endAt: new Date(2026, 10, day, hour + 1).getTime(),
});
function render(items: AgendaItem[] | undefined) {
  vi.mocked(useQuery).mockReturnValue(items);
  return renderToStaticMarkup(createElement(AgendaSection, { showSummary: true }));
}

describe("Home agenda summary", () => {
  it("renders crowded-day context and each item title only once", () => {
    const items = [event(10), event(12), event(14), event(16)];
    const html = render(items);
    expect(html).toContain('aria-label="Today summary"');
    expect(html).toContain("schedule has 4 timed events");
    for (const item of items) expect(html.split(item.title)).toHaveLength(2);
  });

  it("hides the summary on quiet, empty and loading days", () => {
    for (const items of [[event(10)], [], undefined]) {
      expect(render(items)).not.toContain('aria-label="Today summary"');
    }
  });

  it("uses the current Today cards, excluding tomorrow and reflecting removals", () => {
    const today = [event(10), event(12), event(14), event(16)];
    expect(render(today)).toContain("schedule has 4 timed events");
    expect(render([event(10), event(12, 8), event(14, 8), event(16, 8)]))
      .not.toContain('aria-label="Today summary"');
  });
});
