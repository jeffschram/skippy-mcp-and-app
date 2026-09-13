import { describe, expect, it } from "vitest";
import { buildMindGraph, excludeClosedProjectTasks } from "../../../../convex/mindGraphHelpers";
import { filterGraph } from "./graph-layout";
const graph = buildMindGraph(
  [
    {
      kind: "project",
      rows: [{ _id: "p", title: "House", processingState: "accepted" }],
    },
    {
      kind: "memory",
      rows: [
        {
          _id: "m",
          legacyId: "old-m",
          title: "Paint colors",
          processingState: "accepted",
        },
        { _id: "secret", processingState: "rejected" },
      ],
    },
    {
      kind: "person",
      rows: [{ _id: "person", name: "Alex", processingState: "accepted" }],
    },
  ],
  [
    {
      _id: "r",
      from: { entityId: "old-m" },
      to: { entityId: "p" },
      type: "mentions",
    },
    {
      _id: "duplicate",
      from: { entityId: "m" },
      to: { entityId: "p" },
      type: "mentions",
    },
    {
      _id: "bad",
      from: { entityId: "secret" },
      to: { entityId: "p" },
      type: "mentions",
    },
    {
      _id: "missing",
      from: { entityId: "absent" },
      to: { entityId: "p" },
      type: "mentions",
    },
  ],
  false,
);
describe("Mind graph", () => {
  it("excludes archives on every lifecycle axis and drops their canonical and legacy connections", () => {
    const result = buildMindGraph(
      [
        {
          kind: "project",
          rows: [
            {
              _id: "archived-project",
              title: "Booking options evaluation",
              processingState: "accepted",
              status: "archived",
            },
            {
              _id: "active",
              processingState: "accepted",
              status: "in_progress",
            },
          ],
        },
        {
          kind: "memory",
          rows: [
            {
              _id: "archived-memory",
              legacyId: "old-memory",
              processingState: "accepted",
              reviewState: "archived",
            },
          ],
        },
        {
          kind: "person",
          rows: [{ _id: "archived-person", processingState: "archived" }],
        },
        {
          kind: "task",
          rows: [
            { _id: "finished", processingState: "accepted", status: "done" },
          ],
        },
      ],
      [
        "archived-project",
        "archived-memory",
        "old-memory",
        "archived-person",
        "finished",
      ].map((id) => ({
        _id: id,
        from: { entityId: id },
        to: { entityId: "active" },
        type: "related_to",
      })),
      false,
    );
    expect(result.nodes.map((n) => n.id)).toEqual(["active"]);
    expect(result.edges).toEqual([]);
  });
  it("excludes terminal statuses and execution states from every Mind view while retaining open work", () => {
    const closed = ["done", "completed", "cancelled", "achieved", "abandoned", "discarded", "rejected"];
    const rows = closed.flatMap(status => [
      { _id: status, legacyId: `legacy-${status}`, status, processingState: "accepted" },
      { _id: `execution-${status}`, status: "todo", executionState: status, processingState: "accepted" },
    ]);
    const open = ["todo", "in_progress", "waiting", "paused", "read", "saved"];
    const result = buildMindGraph([{ kind: "task", rows: [...rows, ...open.map(status => ({ _id: status, status, processingState: "accepted" }))] }],
      rows.flatMap(row => [row._id, row.legacyId].filter(Boolean).map(id => ({ _id: `edge-${id}`, from: { entityId: id! }, to: { entityId: "todo" }, type: "related_to" }))), false);
    expect(result.nodes.map(n => n.id)).toEqual(open);
    expect(result.edges).toEqual([]);
    expect(filterGraph(result, new Set(["task"]), "", null).nodes.map(n => n.id)).toEqual(open);
  });
  it("resolves legacy Knowledge references, deduplicates edges, and excludes rejected or missing endpoints", () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(["p", "m", "person"]);
    expect(graph.edges).toEqual([
      { id: "r", source: "m", target: "p", type: "mentions" },
    ]);
  });
  it("filters nodes and edges together, and restricts neighborhoods to direct connections", () => {
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    expect(filterGraph(graph, kinds, "", "p").nodes.map((n) => n.id)).toEqual([
      "p",
      "m",
    ]);
    expect(filterGraph(graph, kinds, "paint", null).edges).toEqual([]);
    expect(
      filterGraph(graph, new Set(["person"]), "", null).nodes.map((n) => n.id),
    ).toEqual(["person"]);
    expect(filterGraph(graph, new Set(), " ", null).nodes).toEqual([]);
  });
});


describe("tasks of closed projects", () => {
  it("checks parents outside the graph sample and preserves standalone and active-project tasks", async () => {
    const tasks = ["archived", "processing-archived", "mixed", "completed", "cancelled", "active", "standalone"].map(_id => ({ _id, processingState: "accepted" }));
    const parents: Record<string, { status?: string; processingState?: string }[]> = {
      archived: [{ status: "archived" }],
      "processing-archived": [{ processingState: "archived" }],
      mixed: [{ status: "in_progress" }, { status: "archived" }],
      completed: [{ status: "completed" }],
      cancelled: [{ status: "cancelled" }],
      active: [{ status: "paused" }],
      standalone: [],
    };
    const visible = await excludeClosedProjectTasks(tasks, async id => parents[id]!);
    expect(visible.map(task => task._id)).toEqual(["active", "standalone"]);
    const graph = buildMindGraph([{ kind: "task", rows: visible }], [{
      _id: "hidden-edge", from: { entityId: "archived" }, to: { entityId: "active" }, type: "related_to",
    }], false);
    expect(graph.nodes.map(node => node.id)).toEqual(["active", "standalone"]);
    expect(graph.edges).toEqual([]);
  });
});
