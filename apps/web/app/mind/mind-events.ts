import type { AgendaItem } from "@skippy/shared";
import type { MindGraph, MindNode } from "../../../../convex/mindGraphHelpers";
import { todayRange } from "./mind-attention-model";
import type { FeedRow } from "./mind-attention-model";

/** Use the same day/eligibility rules as Attention; never invent event relationships. */
export function withMindEvents(graph: MindGraph, agenda: AgendaItem[], now: number): MindGraph {
  const { from, to } = todayRange(now);
  const existing = new Set(graph.nodes.map(node => node.id));
  const events: MindNode[] = agenda.filter(item => item.source === "event" && item.at >= from && item.at <= to && (item.endAt ?? item.at) >= now && !existing.has(item.id)).map(item => ({
    id: item.id, kind: "event", title: item.title, summary: item.location ?? "", status: "scheduled", href: item.href ?? "", agenda: item,
  }));
  return { ...graph, nodes: [...graph.nodes, ...events] };
}
export function eventFeedRow(item: AgendaItem): FeedRow {
  const when = item.isAllDay ? "All day" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(item.at);
  return { key: `event:${item.id}`, entityId: item.id, title: item.title, reason: `Event · ${when}`, group: "today", agenda: item };
}
