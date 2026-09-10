import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
export type Position = [number, number, number];
// Mind uses a stronger palette so small nodes remain distinguishable on the dark canvas.
export const KINDS: Record<MindKind, { label: string; color: string }> = {
  project: { label: "Projects", color: "#4DA3FF" },
  task: { label: "Tasks", color: "#20D5D2" },
  goal: { label: "Goals", color: "#F4D447" },
  person: { label: "People", color: "#F36AC4" },
  company: { label: "Companies", color: "#F59A38" },
  memory: { label: "Memories", color: "#AC78F5" },
  note: { label: "Notes", color: "#75CE45" },
  link: { label: "Links", color: "#EF6258" },
  knowledgeObject: { label: "Knowledge objects", color: "#A6B5C8" },
};
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
