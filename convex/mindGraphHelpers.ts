import type { AttentionRecord } from "./attentionModel";
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
export type MindNode = AttentionRecord & {
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
export type MindOwner = { id: string; title: string; personId?: string };
export type MindGraph = {
  owner?: MindOwner;
  nodes: MindNode[];
  edges: MindEdge[];
  limited: boolean;
};
export type MindRecord = AttentionRecord & {
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
  reviewState?: string;
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
      // Exclude archives on either lifecycle axis before registering graph aliases.
      if (
        row.processingState !== "accepted" ||
        row.status === "archived" ||
        row.reviewState === "archived"
      )
        continue;
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
        ...(row.attention ? { attention: row.attention } : {}),
        ...(row.dueAt !== undefined ? { dueAt: row.dueAt } : {}),
        ...(row.commitment ? { commitment: row.commitment } : {}),
        ...(row.executionState ? { executionState: row.executionState } : {}),
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

/** Match only an unambiguous contact in the already owner-scoped, accepted set. */
export function mindOwner(
  user: { _id: string; displayName?: string; email?: string },
  people: (MindRecord & { emails?: string[] })[],
): MindOwner {
  const normalize = (value: string) => value.trim().toLowerCase();
  const emailMatches = user.email
    ? people.filter((p) =>
        p.emails?.some((e) => normalize(e) === normalize(user.email!)),
      )
    : [];
  const nameMatches = user.displayName
    ? people.filter(
        (p) => normalize(p.name || "") === normalize(user.displayName!),
      )
    : [];
  const matches = emailMatches.length ? emailMatches : nameMatches;
  const person = matches.length === 1 ? matches[0] : undefined;
  return {
    id: `owner:${user._id}`,
    title: user.displayName || person?.name || "You",
    ...(person ? { personId: person._id } : {}),
  };
}

/** Parent lookups must include projects outside the visible graph sample. */
export async function excludeArchivedProjectTasks<T extends { _id: string }>(
  tasks: T[],
  loadParents: (taskId: string) => Promise<{ status?: string; processingState?: string }[]>,
): Promise<T[]> {
  const visible = await Promise.all(tasks.map(async task => {
    const parents = await loadParents(String(task._id));
    return !parents.some(parent => parent.status === "archived" || parent.processingState === "archived");
  }));
  return tasks.filter((_, index) => visible[index]);
}
