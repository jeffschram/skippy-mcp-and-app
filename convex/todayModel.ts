// Consume the same deduplicated, visible Today projection as the cards. Titles
// deliberately aren't part of this contract: this is context, not another list.
type SummaryItem = {
  source: "task" | "event" | "recurrence" | "review";
  at?: number | null | undefined;
  endAt?: number | null | undefined;
  isAllDay?: boolean | undefined;
  isWant?: boolean | undefined;
  reviewAt?: number | null | undefined;
};
type SummaryContext = { now: number; start: number; partial?: boolean };

export function buildTodaySummary(items: readonly SummaryItem[], { now, start, partial }: SummaryContext): string | null {
  const dated = items.filter((item): item is SummaryItem & { at: number } =>
    typeof item.at === "number" && Number.isFinite(item.at) && !item.isWant);
  const overdue = dated.filter(item => item.source !== "event" && item.source !== "review" && item.at < start).length;
  const next = dated.filter(item => !item.isAllDay && item.at >= now)
    .sort((a, b) => a.at - b.at || a.source.localeCompare(b.source))[0];
  const events = dated.filter(item => item.source === "event" && !item.isAllDay).sort((a, b) => a.at - b.at);
  const reviews = items.filter(item => item.reviewAt != null && Number.isFinite(item.reviewAt) && item.reviewAt <= now).length;
  const sentences: string[] = [];
  if (overdue) sentences.push(`${overdue} overdue item${overdue === 1 ? "" : "s"}.`);
  if (next) {
    const label = { task: "task", event: "event", recurrence: "repeat", review: "review" }[next.source];
    const time = new Date(next.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    sentences.push(`Next ${label} at ${time}.`);
  }
  if (events.length) sentences.push(`Today's schedule has ${events.length} timed event${events.length === 1 ? "" : "s"}.`);
  let latestEnd = -Infinity;
  for (const event of events) {
    // Missing/invalid durations cannot establish a scheduling conflict.
    if (event.endAt == null || !Number.isFinite(event.endAt) || event.endAt <= event.at) continue;
    if (event.at < latestEnd) {
      sentences.push("Some of today's timed events overlap.");
      break;
    }
    latestEnd = Math.max(latestEnd, event.endAt);
  }
  if (reviews) sentences.push(`${reviews} review${reviews === 1 ? "" : "s"} due.`);
  return sentences.length ? `${partial ? "In shown items: " : ""}${sentences.join(" ")}` : null;
}
