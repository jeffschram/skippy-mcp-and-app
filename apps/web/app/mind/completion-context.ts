import type { MindGraph } from "../../../../convex/mindGraphHelpers";

/** Prefer the project the user came from, then another directly linked project. */
export function completionProject(graph: MindGraph, taskId: string, previousId: string | null): string | null {
  const projectIds = graph.edges.flatMap(edge => edge.source === taskId ? [edge.target] : edge.target === taskId ? [edge.source] : [])
    .filter(id => graph.nodes.some(node => node.id === id && node.kind === "project"));
  return projectIds.find(id => id === previousId) ?? projectIds[0] ?? null;
}
