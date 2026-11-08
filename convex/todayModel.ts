import type { AgendaItem } from "@skippy/shared";

// Consume the same Today projection as the cards. Titles deliberately aren't
// part of this contract: the briefing adds schedule context, never another list.
type SummaryItem = Pick<AgendaItem, "source" | "at" | "endAt" | "isAllDay">;

export function buildTodaySummary(items: readonly SummaryItem[]): string | null {
  const events = items
    .filter((item) => item.source === "event" && !item.isAllDay)
    .sort((a, b) => a.at - b.at);
  const sentences: string[] = [];
  if (events.length >= 4) {
    sentences.push(`Today's schedule has ${events.length} timed events.`);
  }
  let latestEnd = -Infinity;
  for (const event of events) {
    // Missing/invalid durations cannot establish a scheduling conflict.
    if (event.endAt === undefined || !Number.isFinite(event.endAt) || event.endAt <= event.at) continue;
    if (event.at < latestEnd) {
      sentences.push("Some of today's timed events overlap.");
      break;
    }
    latestEnd = Math.max(latestEnd, event.endAt);
  }
  return sentences.length ? sentences.join(" ") : null;
}
