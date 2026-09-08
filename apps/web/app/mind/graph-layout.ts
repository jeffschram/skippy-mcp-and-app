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
/** Deterministic force layout: real edges attract; nodes repel. No invented links. */
export function layoutGraph(graph: MindGraph): Map<string, Position> {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const points: Position[] = nodes.map((_, i) => {
    const y = 1 - (2 * (i + 0.5)) / nodes.length,
      r = Math.sqrt(1 - y * y),
      a = i * 2.399963;
    return [Math.cos(a) * r * 18, y * 18, Math.sin(a) * r * 18];
  });
  const links = graph.edges.flatMap((e) => {
    const a = index.get(e.source),
      b = index.get(e.target);
    return a === undefined || b === undefined ? [] : [[a, b] as const];
  });
  for (let step = 0; step < 100; step++) {
    const forces: Position[] = points.map((p) => [
      -p[0] * 0.018,
      -p[1] * 0.018,
      -p[2] * 0.018,
    ]);
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!,
          b = points[j]!,
          d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const sq = d.reduce((s, v) => s + v * v, 0) + 0.2,
          strength = 6 / (sq * Math.sqrt(sq));
        for (let k = 0; k < 3; k++) {
          forces[i]![k]! += d[k]! * strength;
          forces[j]![k]! -= d[k]! * strength;
        }
      }
    for (const [i, j] of links) {
      const a = points[i]!,
        b = points[j]!;
      for (let k = 0; k < 3; k++) {
        const f = (b[k]! - a[k]!) * 0.035;
        forces[i]![k]! += f;
        forces[j]![k]! -= f;
      }
    }
    const cooling = 0.8 * (1 - step / 125);
    points.forEach((p, i) => {
      for (let k = 0; k < 3; k++)
        p[k]! += Math.max(-1, Math.min(1, forces[i]![k]!)) * cooling;
    });
  }
  return new Map(nodes.map((n, i) => [n.id, points[i]!]));
}
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
