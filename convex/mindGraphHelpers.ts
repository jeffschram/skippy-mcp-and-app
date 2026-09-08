/** Serializable, read-only graph model shared with the Mind experiment. */
export type MindKind =
  | "goal"
  | "project"
  | "task"
  | "person"
  | "company"
  | "note"
  | "link"
  | "knowledgeObject"
  | "memory";
export type MindNode = {
  id: string;
  kind: MindKind;
  title: string;
  summary: string;
  status: string;
  href: string;
};
export type MindEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
};
export type MindGraph = {
  nodes: MindNode[];
  edges: MindEdge[];
  limited: boolean;
};
export type MindRecord = {
  _id: string;
  kind?: string;
  legacyId?: string;
  title?: string;
  name?: string;
  summary?: string;
  description?: string;
  body?: string;
  relationshipContext?: string;
  status?: string;
  url?: string;
  processingState?: string;
};
export function buildMindGraph(
  groups: { kind: MindKind; rows: MindRecord[] }[],
  relationships: {
    _id: string;
    from: { entityId: string };
    to: { entityId: string };
    type: string;
  }[],
  limited: boolean,
): MindGraph {
  const nodes: MindNode[] = [];
  const aliases = new Map<string, string>();
  for (const group of groups)
    for (const row of group.rows) {
      // Never expose rejected/suggested records, including through legacy aliases.
      if (row.processingState !== "accepted") continue;
      const kind = group.kind;
      const id = String(row._id);
      aliases.set(id, id);
      if (row.legacyId) aliases.set(row.legacyId, id);
      const href =
        kind === "project"
          ? `/projects/${encodeURIComponent(id)}`
          : kind === "task"
            ? `/tasks#task-${encodeURIComponent(id)}`
            : kind === "memory"
              ? `/memory/${encodeURIComponent(id)}`
              : kind === "person" || kind === "company"
                ? "/brain/people"
                : kind === "goal"
                  ? "/brain/goals"
                  : "/brain/library";
      nodes.push({
        id,
        kind,
        href,
        title: (
          row.title ||
          row.name ||
          row.url ||
          row.body?.slice(0, 80) ||
          "Untitled"
        ).slice(0, 200),
        summary: (
          row.summary ||
          row.description ||
          row.body ||
          row.relationshipContext ||
          ""
        ).slice(0, 1200),
        status: row.status || "",
      });
    }
  const seen = new Set<string>();
  const edges: MindEdge[] = [];
  for (const rel of relationships) {
    const source = aliases.get(rel.from.entityId),
      target = aliases.get(rel.to.entityId);
    if (!source || !target || source === target) continue;
    const key = `${source}:${rel.type}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: String(rel._id), source, target, type: rel.type });
  }
  return { nodes, edges, limited };
}
