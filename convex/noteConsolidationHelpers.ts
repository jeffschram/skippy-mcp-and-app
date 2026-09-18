/** Promote legacy text while keeping the original properties intact. */
export function consolidatedNoteFields(row: {
  title?: string;
  body?: string;
  summary?: string;
  properties?: unknown;
}) {
  const properties =
    row.properties &&
    typeof row.properties === "object" &&
    !Array.isArray(row.properties)
      ? (row.properties as Record<string, unknown>)
      : {};
  const text = (...values: unknown[]) =>
    values.find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  return {
    kind: "note" as const,
    title: text(row.title, properties.title),
    body:
      text(
        row.body,
        properties.body,
        properties.text,
        row.summary,
        properties.sourceSummary,
        row.title,
      ) ?? "",
    summary: text(row.summary, properties.sourceSummary),
  };
}
