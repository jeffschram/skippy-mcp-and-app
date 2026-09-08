import { describe, expect, it } from "vitest";
import { buildMindGraph } from "../../../../convex/mindGraphHelpers";
import { filterGraph, layoutGraph } from "./graph-layout";
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
  it("resolves legacy Knowledge references, deduplicates edges, and excludes rejected or missing endpoints", () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(["p", "m", "person"]);
    expect(graph.edges).toEqual([
      { id: "r", source: "m", target: "p", type: "mentions" },
    ]);
  });
  it("keeps isolated records and creates finite, repeatable 3D positions", () => {
    const positions = layoutGraph(graph);
    expect(positions.size).toBe(3);
    for (const p of positions.values())
      expect(p.every(Number.isFinite)).toBe(true);
    expect(
      layoutGraph({ ...graph, nodes: [...graph.nodes].reverse() }),
    ).toEqual(positions);
    expect(layoutGraph({ nodes: [], edges: [], limited: false }).size).toBe(0);
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
