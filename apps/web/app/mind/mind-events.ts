import type { AgendaItem } from "@skippy/shared";
import type { MindGraph, MindNode } from "../../../../convex/mindGraphHelpers";
export function todayRange(now: number) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.getTime(), to: end.getTime() - 1 };
}

/** Browse upcoming events today; never invent event relationships. */
export function withMindEvents(graph: MindGraph, agenda: AgendaItem[], now: number): MindGraph {
  const { from, to } = todayRange(now);
  const existing = new Set(graph.nodes.map(node => node.id));
  const events: MindNode[] = agenda.filter(item => item.source === "event" && item.at >= from && item.at <= to && (item.endAt ?? item.at) >= now && !existing.has(item.id)).map(item => ({
    id: item.id, kind: "event", title: item.title, summary: item.location ?? "", status: "scheduled", href: item.href ?? "", agenda: item,
  }));
  return { ...graph, nodes: [...graph.nodes, ...events] };
}
