import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomePlanning } from "./home-planning";

const fixture = vi.hoisted(() => ({
  now: new Date(2026, 10, 8, 12).getTime(),
  boolIndex: 0,
  boolStates: [] as boolean[],
  toggleAll: undefined as (() => void) | undefined,
  queries: [] as any[],
  page: undefined as { rows: any[]; hasMore: boolean; cursor: string | null } | undefined,
}));
// Seed the clock and reactive page cache for server-rendered presentation tests.
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    if (typeof initial === "boolean") {
      const index = fixture.boolIndex++;
      const [value] = react.useState(fixture.boolStates[index] ?? initial);
      return [value, (next: boolean) => { fixture.boolStates[index] = next; }];
    }
    return react.useState(
      initial === 0 ? fixture.now :
        initial && typeof initial === "object" && !Array.isArray(initial) && Object.keys(initial).length === 0
          ? fixture.page ? { 0: fixture.page } : {} : initial,
    );
  } };
});
vi.mock("convex/react", () => ({ useQuery: (_query: unknown, args: unknown) => { fixture.queries.push(args); return undefined; } }));
vi.mock("./use-viewer", () => ({ useViewerReady: () => true }));
vi.mock("./home-item-actions", () => ({
  HomeActionsProvider: ({ children }: { children: ReactNode }) => children,
  HomeItemActions: () => null, ItemActionFeedback: () => null,
}));
vi.mock("./item-details-modal", () => ({ ItemDetailsModal: () => null }));
vi.mock("./life-tasks", () => ({ AddRow: () => null, HomeItemRow: ({ row }: any) => <span>{row.title}</span> }));
vi.mock("../components", () => ({
  Section: ({ title, children }: any) => {
    if (title?.props?.["aria-controls"] === "home-all") fixture.toggleAll = title.props.onClick;
    return <section><h2>{title}</h2>{children}</section>;
  },
  Button: ({ children }: any) => <button>{children}</button>,
  LoadingRow: ({ label }: any) => <p>{label}</p>, Dialog: () => null,
}));
const render = () => {
  fixture.boolIndex = 0;
  fixture.queries = [];
  return renderToStaticMarkup(createElement(HomePlanning));
};

describe("Home planning shell", () => {
  it("places Summary above Today, Upcoming and collapsed All using the displayed rows", () => {
    fixture.page = { rows: [{ kind: "task", id: "one", title: "Private task", at: fixture.now - 86400000 }], hasMore: true, cursor: "next" };
    // A full visible batch stops automatic loading and qualifies the summary.
    fixture.page.rows = Array.from({ length: 20 }, (_, id) => ({ ...fixture.page!.rows[0], id: String(id), title: `Private task ${id}` }));
    const html = render();
    const positions = ["<h2>Summary", "<h2>Today", "<h2>Upcoming", 'aria-controls="home-all"'].map(text => html.indexOf(text));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain("In shown items: 20 overdue items.");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="home-all" hidden=""');
    expect(html).not.toContain("The week ends today");
    expect(html).not.toContain("<select");
    expect(html).toContain("Add task / repeat");
  });

  it("preserves both empty sections while hiding an unhelpful summary", () => {
    fixture.page = { rows: [], hasMore: false, cursor: null };
    const html = render();
    expect(html).not.toContain("<h2>Summary");
    expect(html.split("Nothing here right now.")).toHaveLength(3);
    expect(html).toContain("<h2>Upcoming");
  });

  it("does not present loading pages as empty or zero summaries", () => {
    fixture.page = undefined;
    const html = render();
    expect(html).toContain("Loading Upcoming");
    expect(html).not.toContain("Nothing here right now.");
    expect(html).not.toContain("<h2>Summary");
  });

  it("opens All and queries open items without an area filter", () => {
    fixture.boolStates = [];
    fixture.page = { rows: [], hasMore: false, cursor: null };
    render();
    expect(fixture.queries.map(args => args.period)).toEqual(["today", "week"]);
    fixture.toggleAll!();
    const html = render();
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('id="home-all" hidden');
    expect(fixture.queries.map(args => args.period)).toEqual(["today", "week", "all"]);
    for (const args of fixture.queries) {
      expect(args.status).toBe("open");
      expect(args).not.toHaveProperty("area");
    }
    fixture.boolStates = [];
  });
});
