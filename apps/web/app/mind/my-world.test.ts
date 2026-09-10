import { describe, expect, it } from "vitest";
import { mindOwner, type MindGraph } from "../../../../convex/mindGraphHelpers";
import { buildMyWorld } from "./my-world";
import { KINDS, filterGraph } from "./graph-layout";
const graph: MindGraph = {
  owner: { id: "owner:u", title: "Jeff Schram", personId: "self" },
  nodes: [
    {
      id: "self",
      kind: "person",
      title: "Jeff Schram",
      summary: "",
      status: "",
      href: "/brain/people",
    },
    {
      id: "p",
      kind: "project",
      title: "Planner",
      summary: "",
      status: "idea",
      href: "/projects/p",
    },
    {
      id: "t1",
      kind: "task",
      title: "First task",
      summary: "",
      status: "todo",
      href: "/tasks",
    },
    {
      id: "t2",
      kind: "task",
      title: "Second task",
      summary: "",
      status: "done",
      href: "/tasks",
    },
  ],
  edges: [
    { id: "r", source: "t1", target: "p", type: "belongs_to" },
    { id: "self-r", source: "self", target: "p", type: "related_to" },
  ],
  limited: false,
};
const all = new Set(Object.keys(KINDS) as (keyof typeof KINDS)[]);
describe("My world sphere", () => {
  it("pins the owner to the origin without category nodes or a duplicate self contact", () => {
    const world = buildMyWorld(graph, graph, all);
    expect(world.positions.get("owner:u")).toEqual([0, 0, 0]);
    expect(world.nodes.filter((n) => n.role === "owner")).toHaveLength(1);
    expect(world.nodes).toHaveLength(4);
    expect(world.nodes.some((n) => n.id === "self")).toBe(false);
    expect(world.nodes.find((n) => n.id === "p")?.role).toBe("record");
    expect(world.nodes.find((n) => n.id === "owner:u")?.title).toBe(
      "Jeff Schram",
    );
  });
  it("connects every record directly to the owner without inventing stored relationships", () => {
    const world = buildMyWorld(graph, graph, all);
    for (const node of world.nodes.filter((n) => n.role !== "owner")) {
      const parents = world.edges.filter(
        (e) => e.role === "branch" && e.target === node.id,
      );
      expect(parents).toHaveLength(1);
      expect(parents[0]?.source).toBe(world.ownerId);
    }
    expect(world.edges.filter((e) => e.role === "relationship")).toEqual([
      { id: "r", source: "t1", target: "p", role: "relationship" },
      { id: "self-r", source: "owner:u", target: "p", role: "relationship" },
    ]);
    expect(graph.edges).toHaveLength(2);
  });
  it("keeps positions stable across filtering and input ordering, with no dangling edges", () => {
    const full = buildMyWorld(graph, graph, all);
    const visible = filterGraph(graph, new Set(["task"]), "First", null);
    const filtered = buildMyWorld(graph, visible, new Set(["task"]));
    expect(filtered.positions.get("t1")).toEqual(full.positions.get("t1"));
    const ids = new Set(filtered.nodes.map((n) => n.id));
    expect(
      filtered.edges.every((e) => ids.has(e.source) && ids.has(e.target)),
    ).toBe(true);
    expect(
      buildMyWorld({ ...graph, nodes: [...graph.nodes].reverse() }, graph, all)
        .positions,
    ).toEqual(full.positions);
    expect(
      [...full.positions.values()].every((p) => p.every(Number.isFinite)),
    ).toBe(true);
  });
  it("distributes records in all three dimensions with category colors", () => {
    const sample = {
      ...graph,
      nodes: Array.from({ length: 100 }, (_, i) => ({
        ...graph.nodes[1]!,
        id: `record:${i}`,
      })),
    };
    const world = buildMyWorld(sample, sample, all);
    const points = world.nodes
      .filter((n) => n.role === "record")
      .map((n) => world.positions.get(n.id)!);
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.min(...points.map((p) => p[axis]!))).toBeLessThan(-18);
      expect(Math.max(...points.map((p) => p[axis]!))).toBeGreaterThan(18);
    }
    expect(
      points.every((p) => Math.hypot(...p) >= 20 && Math.hypot(...p) <= 28),
    ).toBe(true);
    expect(
      world.nodes
        .filter((n) => n.role === "record")
        .every((n) => n.color === KINDS.project.color),
    ).toBe(true);
  });
  it("still shows the owner when the graph or filters are empty", () => {
    const empty = buildMyWorld(
      { nodes: [], edges: [], limited: false },
      { nodes: [], edges: [], limited: false },
      new Set(),
    );
    expect(empty.nodes).toEqual([
      { id: "owner:self", title: "You", role: "owner", color: "#DCEEFF" },
    ]);
  });
});
describe("Mind owner identity", () => {
  it("prefers a unique matching email and does not hard-code the owner name", () => {
    expect(
      mindOwner({ _id: "u", displayName: "Alex", email: "A@example.com" }, [
        { _id: "p", name: "A. Smith", emails: ["a@example.com"] },
      ]),
    ).toEqual({ id: "owner:u", title: "Alex", personId: "p" });
  });
  it("uses an unambiguous name match but does not merge namesakes or ambiguous emails", () => {
    expect(
      mindOwner({ _id: "u", displayName: "Jeff Schram" }, [
        { _id: "p", name: "Jeff Schram" },
      ]).personId,
    ).toBe("p");
    expect(
      mindOwner({ _id: "u", displayName: "Jeff" }, [
        { _id: "a", name: "Jeff" },
        { _id: "b", name: "Jeff" },
      ]).personId,
    ).toBeUndefined();
    expect(
      mindOwner({ _id: "u", displayName: "Jeff", email: "a@b.com" }, [
        { _id: "a", name: "Jeff", emails: ["a@b.com"] },
        { _id: "b", name: "Other", emails: ["a@b.com"] },
      ]).personId,
    ).toBeUndefined();
  });
});
