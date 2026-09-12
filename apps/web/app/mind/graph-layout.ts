import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
export type Position = [number, number, number];
// Shared by the sculptures, filters, and record details.
export type MindShape = "cube" | "pyramid" | "ring" | "sphere" | "cylinder" | "octahedron" | "slab" | "cross" | "capsule";
export const KINDS: Record<MindKind, { label: string; color: string; shape: MindShape }> = {
  project: { label: "Projects", color: "#286C70", shape: "cube" },
  task: { label: "Tasks", color: "#657968", shape: "pyramid" },
  goal: { label: "Goals", color: "#E0A126", shape: "ring" },
  person: { label: "People", color: "#C7472C", shape: "sphere" },
  company: { label: "Companies", color: "#AB3827", shape: "cylinder" },
  memory: { label: "Memories", color: "#D16B2F", shape: "octahedron" },
  note: { label: "Notes", color: "#91AAA2", shape: "slab" },
  link: { label: "Links", color: "#30475B", shape: "cross" },
  knowledgeObject: { label: "Knowledge objects", color: "#BE9136", shape: "capsule" },
};
export const MIND_OWNER_COLOR = "#F7E7C7";
export function filterGraph(
  graph: MindGraph,
  enabled: Set<MindKind>,
  query: string,
  focus: string | null,
): MindGraph {
  const neighbors = new Set([focus]);
  if (focus)
    for (const e of graph.edges) {
      if (e.source === focus) neighbors.add(e.target);
      if (e.target === focus) neighbors.add(e.source);
    }
  const search = query.trim().toLowerCase();
  const nodes = graph.nodes.filter(
    (n) =>
      enabled.has(n.kind) &&
      (!focus || neighbors.has(n.id)) &&
      (!search || `${n.title} ${n.summary}`.toLowerCase().includes(search)),
  );
  const ids = new Set(nodes.map((n) => n.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}
