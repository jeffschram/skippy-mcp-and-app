import type { AgendaItem } from "@skippy/shared";
import type { AttentionKind, AttentionResult } from "../../../../convex/attentionModel";

export type FocusItem = { id: string; kind: AttentionKind; title: string; result: AttentionResult };
export type ReviewItem = { id: string; title: string; reason: string; type: "approval" | "triage" | "memory"; entityId?: string | undefined };
export type FeedRow = { key: string; title: string; reason: string; group: "needs" | "today" | "review" | "next"; entityId?: string | undefined; focus?: FocusItem; agenda?: AgendaItem; review?: ReviewItem; reviews?: ReviewItem[] };
export function todayRange(now: number) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.getTime(), to: end.getTime() - 1 };
}
export function mindAttentionRows(focus: FocusItem[], agenda: AgendaItem[], reviews: ReviewItem[], now: number, query: string): FeedRow[] {
  const rows = new Map<string, FeedRow>();
  const { from, to } = todayRange(now);
  for (const item of focus) {
    if (item.kind === "project") continue;
    const status = item.result.status;
    rows.set(item.id, { key: item.id, entityId: item.id, title: item.title, reason: item.result.reason,
      group: status === "immediate" ? "needs" : status === "stale" ? "review" : status === "scheduled" && item.result.at !== undefined && item.result.at <= to ? "today" : "next", focus: item });
  }
  for (const item of agenda) {
    if (item.at < from || item.at > to || (item.source === "event" && (item.endAt ?? item.at) < now)) continue;
    const key = item.source === "task" ? item.id : `${item.source}:${item.id}`;
    const previous = rows.get(key);
    const when = item.isAllDay ? "All day" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(item.at);
    rows.set(key, { ...previous, key, entityId: item.source === "task" || item.source === "event" ? item.id : undefined, title: item.title,
      reason: `${item.source === "task" ? "Due" : item.source === "recurrence" ? "Recurring" : "Event"} · ${when}${previous ? ` · ${previous.reason}` : ""}`,
      group: previous?.group === "needs" ? "needs" : "today", agenda: item });
  }
  // Explicit identity only: similar titles are not enough to merge two decisions.
  for (const item of reviews) {
    const key = item.entityId ?? `${item.type}:${item.id}`;
    const previous = rows.get(key);
    rows.set(key, { ...previous, key, entityId: item.entityId, title: item.title,
      reason: `${item.reason}${previous ? ` · ${previous.reason}` : ""}`,
      group: item.type === "approval" || previous?.group === "needs" ? "needs" : "review", review: item, reviews: [...(previous?.reviews ?? []), item] });
  }
  const term = query.trim().toLowerCase();
  return [...rows.values()].filter(row => `${row.title} ${row.reason}`.toLowerCase().includes(term)).sort((a,b) =>
    Number(Boolean(b.reviews?.some(item => item.type === "approval"))) - Number(Boolean(a.reviews?.some(item => item.type === "approval"))) ||
    (a.agenda?.at ?? a.focus?.result.at ?? Infinity) - (b.agenda?.at ?? b.focus?.result.at ?? Infinity) || a.title.localeCompare(b.title));
}
