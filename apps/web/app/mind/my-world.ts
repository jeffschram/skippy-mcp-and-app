import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { KINDS, type Position } from "./graph-layout";
export type WorldNode = {
  id: string;
  title: string;
  role: "owner" | "category" | "record";
  color: string;
  kind?: MindKind;
  count?: number;
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

/** A view hierarchy, never written to the relationship table. Every record has one category parent. */
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
  const kinds = Object.keys(KINDS) as MindKind[];
  const visibleIds = new Set(visible.nodes.map((n) => n.id));
  for (const [index, kind] of kinds.entries()) {
    if (!enabled.has(kind)) continue;
    const members = graph.nodes
      .filter((n) => n.kind === kind && n.id !== owner.personId)
      .sort((a, b) => a.id.localeCompare(b.id));
    const shown = members.filter((n) => visibleIds.has(n.id));
    const angle = Math.PI / 2 - (index * Math.PI * 2) / kinds.length;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const id = categoryId(kind);
    nodes.push({
      id,
      kind,
      title: KINDS[kind].label,
      role: "category",
      color: KINDS[kind].color,
      count: shown.length,
    });
    positions.set(id, [direction[0]! * 17, direction[1]! * 17, 0]);
    edges.push({
      id: `branch:${id}`,
      source: owner.id,
      target: id,
      role: "branch",
    });
    for (const [i, record] of members.entries()) {
      if (!visibleIds.has(record.id)) continue;
      // Fixed slots based on the complete sample keep filtering from shuffling records.
      const row = Math.floor(i / 8),
        slot = i % 8;
      const leafAngle = angle + ((slot - 3.5) / 3.5) * 0.23;
      const radius = 25 + row * 2.1;
      const z = Math.sin(i * 2.39996) * 3.2;
      positions.set(record.id, [
        Math.cos(leafAngle) * radius,
        Math.sin(leafAngle) * radius,
        z,
      ]);
      nodes.push({
        id: record.id,
        kind,
        title: record.title,
        role: "record",
        color: KINDS[kind].color,
      });
      edges.push({
        id: `branch:${record.id}`,
        source: id,
        target: record.id,
        role: "branch",
      });
    }
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
