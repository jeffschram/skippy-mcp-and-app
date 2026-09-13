import type { MindGraph } from "../../../../convex/mindGraphHelpers";
import type { Position } from "./graph-layout";

/** Excludes synthetic owner spokes; duplicate/reversed links never add force. */
export function layoutKey(graph: MindGraph): string {
  return JSON.stringify([graph.owner?.id, graph.owner?.personId,
    graph.nodes.map(n => [n.id, n.kind]).sort(),
    graph.edges.map(e => [e.source, e.target, e.type]).sort()]);
}
const strong = new Set(["belongs_to", "supports", "part_of", "works_at"]);
function seed(id: string): Position {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const y = ((hash >>> 0) / 4294967296) * 2 - 1;
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
  const ring = Math.sqrt(1 - y * y);
  return [28 * ring * Math.cos(angle), 28 * y, 28 * ring * Math.sin(angle)];
}
export function relationshipPositions(graph: MindGraph, previous?: Map<string, Position>): Map<string, Position> {
  const owner = graph.owner?.id ?? "owner:self";
  const nodes = graph.nodes.filter(n => n.id !== graph.owner?.personId && n.id !== owner).sort((a,b) => a.id.localeCompare(b.id));
  const index = new Map(nodes.map((n,i) => [n.id,i]));
  const neighbors = new Map<string, Set<string>>();
  const links = new Map<string, { a: number; b: number; weight: number }>();
  for (const edge of graph.edges) {
    const source = edge.source === graph.owner?.personId ? owner : edge.source;
    const target = edge.target === graph.owner?.personId ? owner : edge.target;
    if (source === target) continue;
    for (const [a,b] of [[source,target],[target,source]]) {
      if (!neighbors.has(a!)) neighbors.set(a!, new Set());
      neighbors.get(a!)!.add(b!);
    }
    const a = index.get(source), b = index.get(target);
    if (a === undefined || b === undefined) continue;
    const key = [Math.min(a,b), Math.max(a,b)].join(":");
    const weight = strong.has(edge.type) ? 1.8 : 1;
    if (weight > (links.get(key)?.weight ?? 0)) links.set(key, { a: Math.min(a,b), b: Math.max(a,b), weight });
  }
  const radius = (id: string, base: number) => {
    const count = neighbors.get(id)?.size ?? 0;
    return base * (count >= 10 ? 3 : count >= 5 ? 2 : count >= 2 ? 1.3 : .8) * 1.35;
  };
  const radii = nodes.map(n => radius(n.id, 1.35));
  const ownerRadius = radius(owner, 3.1);
  const anchors = nodes.map(n => previous?.get(n.id) ?? seed(n.id));
  const points = anchors.map(p => [...p] as Position);
  const orderedLinks = [...links.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,edge]) => edge);
  // Fixed iterations, deterministic seeds, and warm starts avoid a continuously
  // moving simulation. Every record kind participates in the same constraints.
  for (let step = 0; step < 220; step++) {
    const force = points.map(() => [0,0,0]);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      for (let j = i + 1; j < points.length; j++) {
        const q = points[j]!;
        let dx=p[0]-q[0], dy=p[1]-q[1], dz=p[2]-q[2];
        let distance=Math.hypot(dx,dy,dz);
        if (distance < .001) { dx=.001; dy=.001; dz=.001; distance=Math.hypot(dx,dy,dz); }
        const gap = radii[i]! + radii[j]! + 1.5;
        const push = Math.max(0, gap-distance)*.35 + 5/(distance*distance+1);
        const vector=[dx/distance*push,dy/distance*push,dz/distance*push];
        for (let axis=0;axis<3;axis++) { force[i]![axis]! += vector[axis]!; force[j]![axis]! -= vector[axis]!; }
      }
    }
    for (const {a,b,weight} of orderedLinks) {
      const p=points[a]!, q=points[b]!;
      const distance=Math.max(.001,Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]));
      const rest=radii[a]!+radii[b]!+ (weight>1 ? 3 : 6);
      const pull=Math.max(0,distance-rest)*.075*weight;
      for(let axis=0;axis<3;axis++) { const value=(q[axis]!-p[axis]!)/distance*pull; force[a]![axis]!+=value; force[b]![axis]!-=value; }
    }
    for(let i=0;i<points.length;i++) {
      const p=points[i]!, distance=Math.max(.001,Math.hypot(...p));
      const outward=Math.max(0,ownerRadius+radii[i]!+3-distance)*.6;
      for(let axis=0;axis<3;axis++) {
        const f=force[i]![axis]! + (anchors[i]![axis]!-p[axis]!)*.012 + p[axis]!/distance*outward;
        p[axis]!+=Math.max(-1,Math.min(1,f))*.65;
      }
    }
  }
  return new Map([[owner,[0,0,0] as Position], ...nodes.map((n,i) => [n.id,points[i]!] as [string,Position])]);
}
