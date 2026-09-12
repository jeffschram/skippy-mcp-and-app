import { describe, expect, it } from "vitest";
import { buildMindGraph, excludeArchivedProjectTasks } from "../../../../convex/mindGraphHelpers";
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
    expect(result.nodes.map((n) => n.id)).toEqual(["active", "finished"]);
    expect(result.edges).toEqual([
      {
        id: "finished",
        source: "finished",
        target: "active",
        type: "related_to",
      },
    ]);
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


describe("tasks of archived projects", () => {
  it("checks parents outside the graph sample and preserves standalone and active-project tasks", async () => {
    const tasks = ["archived", "processing-archived", "mixed", "active", "standalone"].map(_id => ({ _id, processingState: "accepted" }));
    const parents: Record<string, { status?: string; processingState?: string }[]> = {
      archived: [{ status: "archived" }],
      "processing-archived": [{ processingState: "archived" }],
      mixed: [{ status: "in_progress" }, { status: "archived" }],
      active: [{ status: "completed" }],
      standalone: [],
    };
    const visible = await excludeArchivedProjectTasks(tasks, async id => parents[id]!);
    expect(visible.map(task => task._id)).toEqual(["active", "standalone"]);
    const graph = buildMindGraph([{ kind: "task", rows: visible }], [{
      _id: "hidden-edge", from: { entityId: "archived" }, to: { entityId: "active" }, type: "related_to",
    }], false);
    expect(graph.nodes.map(node => node.id)).toEqual(["active", "standalone"]);
    expect(graph.edges).toEqual([]);
  });
});
