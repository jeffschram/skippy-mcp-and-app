import { describe, expect, it } from "vitest";
import { withMindEvents, eventFeedRow } from "./mind-events";
import { buildMyWorld, revealWorld } from "./my-world";
import { filterGraph } from "./graph-layout";
import { mindAttentionRows } from "./mind-attention-model";
import type { MindGraph } from "../../../../convex/mindGraphHelpers";
const now = new Date(2026, 8, 18, 12).getTime();
const event = { id: "calendar-event", source: "event" as const, title: "Dinner with Jon", location: "Cafe Silvium", at: now + 3600000, endAt: now + 7200000, href: "https://calendar.google.com/event" };
const graph: MindGraph = { nodes: [], edges: [], limited: false };
describe("Mind event parity", () => {
  it("makes today's Attention events searchable, visible in overview, and selectable by the same ID", () => {
    const result = withMindEvents(graph, [event], now);
    expect(mindAttentionRows([], [event], [], now, "")[0]?.entityId).toBe(event.id);
    expect(filterGraph(result, new Set(["event"]), "Dinner with Jon", null).nodes[0]?.agenda).toEqual(event);
    expect(revealWorld(buildMyWorld(result, result, new Set(["event"]), now), null, false).nodes.some(n => n.id === event.id)).toBe(true);
    expect(eventFeedRow(event).agenda?.href).toBe(event.href);
    expect(result.edges).toEqual([]);
  });
  it("matches Attention eligibility, excluding past events and other days without duplicating tasks", () => {
    const items = [event, { ...event, id: "past", at: now - 2000, endAt: now - 1000 }, { ...event, id: "tomorrow", at: now + 86400000 }, { ...event, id: "task", source: "task" as const }];
    expect(withMindEvents(graph, items, now).nodes.map(n => n.id)).toEqual([event.id]);
    expect(withMindEvents(withMindEvents(graph, [event], now), [event], now).nodes).toHaveLength(1);
  });
});
