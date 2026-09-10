import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { KINDS, type Position } from "./graph-layout";
export type WorldNode = {
  id: string;
  title: string;
  role: "owner" | "record";
  color: string;
  kind?: MindKind;
};
export type WorldEdge = {
  id: string;
  source: string;
  target: string;
  role: "branch" | "relationship";
};
export type WorldGraph = {
  nodes: WorldNode[];
  edges: WorldEdge[];
  positions: Map<string, Position>;
  ownerId: string;
};
export const categoryId = (kind: MindKind) => `category:${kind}`;
export const categoryKind = (id: string | null): MindKind | undefined =>
  (Object.keys(KINDS) as MindKind[]).find((k) => categoryId(k) === id);

/** A spherical view of the user’s world; structural links are never saved relationships. */
export function buildMyWorld(
  graph: MindGraph,
  visible: MindGraph,
  enabled: Set<MindKind>,
): WorldGraph {
  const owner = graph.owner || { id: "owner:self", title: "You" };
  const nodes: WorldNode[] = [
    { id: owner.id, title: owner.title, role: "owner", color: "#DCEEFF" },
  ];
  const edges: WorldEdge[] = [];
  const positions = new Map<string, Position>([[owner.id, [0, 0, 0]]]);
  const visibleIds = new Set(visible.nodes.map((n) => n.id));
  const records = graph.nodes
    .filter((n) => n.id !== owner.personId)
    .sort((a, b) => a.id.localeCompare(b.id));
  // Fibonacci directions cover the whole sphere. A shallow variation in radius
  // adds depth, while slots based on the full sample stay stable under filtering.
  for (const [i, record] of records.entries()) {
    if (!visibleIds.has(record.id) || !enabled.has(record.kind)) continue;
    const y = 1 - (2 * (i + 0.5)) / records.length;
    const ring = Math.sqrt(1 - y * y);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 24 + 4 * Math.sin(i * 1.618);
    positions.set(record.id, [
      Math.cos(angle) * ring * radius,
      y * radius,
      Math.sin(angle) * ring * radius,
    ]);
    nodes.push({
      id: record.id,
      kind: record.kind,
      title: record.title,
      role: "record",
      color: KINDS[record.kind].color,
    });
    edges.push({
      id: `branch:${record.id}`,
      source: owner.id,
      target: record.id,
      role: "branch",
    });
  }
  // Saved relationships are a separate overlay for the selected record only.
  const ids = new Set(nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    const source = edge.source === owner.personId ? owner.id : edge.source;
    const target = edge.target === owner.personId ? owner.id : edge.target;
    if (ids.has(source) && ids.has(target) && source !== target) {
      edges.push({ id: edge.id, source, target, role: "relationship" });
    }
  }
  return { nodes, edges, positions, ownerId: owner.id };
}
