type Row = Record<string, any>;

export function legacyKnowledgeDocument(kind: string, row: Row): Row {
  const { _id, _creationTime, relatedEntityRefs, ...fields } = row;
  return {
    ...fields,
    kind,
    legacyId: String(_id),
    ...(kind === "memory" ? {
      processingState: row.status === "inbox" ? "suggested" : row.status,
    } : {}),
  };
}

export function legacyRowMatchesKnowledge(kind: string, row: Row, item: Row) {
  if (kind === "link") {
    return (item.normalizedUrl ?? item.url) === (row.normalizedUrl ?? row.url);
  }
  if (kind === "note") return item.title === row.title && item.body === row.body;
  if (kind === "knowledgeObject") {
    return item.objectType === row.objectType && item.title === row.title
      && JSON.stringify(item.properties) === JSON.stringify(row.properties);
  }
  return item.memoryType === row.memoryType && item.title === row.title && item.body === row.body;
}

// Existing canonical fields always win, including statuses and timestamps.
// Missing fields may be recovered, and provenance is merged rather than lost.
export function adoptionPatch(kind: string, row: Row, existing: Row): Row {
  const legacy = legacyKnowledgeDocument(kind, row);
  const patch: Row = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (existing[key] === undefined) patch[key] = value;
  }
  const ids = new Set([existing.legacyId, ...(existing.legacyIds ?? []), String(row._id)].filter(Boolean));
  patch.legacyId = existing.legacyId ?? String(row._id);
  patch.legacyIds = [...ids];
  if (row.sourceRefIds?.length) {
    patch.sourceRefIds = [...new Set([...(existing.sourceRefIds ?? []), ...row.sourceRefIds])];
  }
  return patch;
}

// IDs are rewritten only as complete values, never inside free-form text.
export function rewriteLegacyReferences(value: any, mapping: Map<string, string>): any {
  if (typeof value === "string") return mapping.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => rewriteLegacyReferences(entry, mapping));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, rewriteLegacyReferences(entry, mapping)]));
  }
  return value;
}
