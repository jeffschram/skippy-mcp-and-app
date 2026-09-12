import { ATTENTION, resolveAttention } from "../../../../convex/attentionModel";
import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { KINDS, MIND_OWNER_COLOR, type Position } from "./graph-layout";
export type WorldNode = {
  id: string;
  title: string;
  role: "owner" | "record";
  color: string;
  kind?: MindKind;
  connectionCount?: number;
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
  now = 0,
): WorldGraph {
  const owner = graph.owner || { id: "owner:self", title: "You" };
  const nodes: WorldNode[] = [
    { id: owner.id, title: owner.title, role: "owner", color: MIND_OWNER_COLOR },
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
      color: ATTENTION[resolveAttention(record.kind, record, now).status].color,
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
  // Count distinct saved neighbors in the full sample so filtering never
  // changes a record's size. Synthetic owner spokes do not count.
  const neighbors = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const a = edge.source === owner.personId ? owner.id : edge.source;
    const b = edge.target === owner.personId ? owner.id : edge.target;
    if (a === b) continue;
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b); neighbors.get(b)!.add(a);
  }
  for (const node of nodes) {
    const count = neighbors.get(node.id)?.size ?? 0;
    if (count) node.connectionCount = count;
  }
  return { nodes, edges, positions, ownerId: owner.id };
}

/** Only saved, direct relationships belong to a selected record's neighborhood. */
export function selectionIds(graph: WorldGraph, selected: string | null): Set<string> {
  const ids = new Set<string>();
  if (!selected || !graph.nodes.some(node => node.id === selected)) return ids;
  ids.add(selected);
  for (const edge of graph.edges) {
    if (edge.role !== "relationship") continue;
    if (edge.source === selected) ids.add(edge.target);
    if (edge.target === selected) ids.add(edge.source);
  }
  return ids;
}

/** Four readable tiers: 0–1, 2–4, 5–9, and 10+ distinct saved neighbors. */
export function nodeVisualSize(node: WorldNode): number {
  const count = node.connectionCount ?? 0;
  const multiplier = count >= 10 ? 3 : count >= 5 ? 2 : count >= 2 ? 1.3 : .8;
  return (node.role === "owner" ? 3.1 : 1.35) * multiplier;
}
