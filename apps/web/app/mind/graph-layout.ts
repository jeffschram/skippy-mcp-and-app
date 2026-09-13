import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
export type Position = [number, number, number];
// Shared by the sculptures, filters, and record details.
export type MindShape = "cube" | "pyramid" | "ring" | "sphere" | "cylinder" | "octahedron" | "slab" | "cross" | "capsule";
export const KINDS: Record<MindKind, { label: string; color: string; shape: MindShape }> = {
  project: { label: "Projects", color: "#3D9D9C", shape: "cube" },
  task: { label: "Tasks", color: "#659FD7", shape: "pyramid" },
  goal: { label: "Goals", color: "#E4B550", shape: "ring" },
  person: { label: "People", color: "#E77F6B", shape: "sphere" },
  company: { label: "Companies", color: "#779B76", shape: "cylinder" },
  memory: { label: "Memories", color: "#AC8CD1", shape: "octahedron" },
  note: { label: "Notes", color: "#E7AD88", shape: "slab" },
  link: { label: "Links", color: "#64BDB0", shape: "cross" },
  knowledgeObject: { label: "Knowledge objects", color: "#CE86A8", shape: "capsule" },
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
