import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
export type Position = [number, number, number];
export const KINDS: Record<MindKind, { label: string; color: string }> = {
  project: { label: "Projects", color: "#A7CEEE" },
  task: { label: "Tasks", color: "#A7EEE8" },
  goal: { label: "Goals", color: "#EEECA7" },
  person: { label: "People", color: "#EEA7D6" },
  company: { label: "Companies", color: "#EED0A7" },
  memory: { label: "Memories", color: "#C5A7EE" },
  note: { label: "Notes", color: "#A7EEA7" },
  link: { label: "Links", color: "#EEA7A7" },
  knowledgeObject: { label: "Knowledge objects", color: "#B1B4EF" },
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
