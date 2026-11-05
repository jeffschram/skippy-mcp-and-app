/** Home's single daily selection. No generated prose can invent a separate task. */
export type TodayCandidate = {
  id: string; title: string; href: string; kind: 'task' | 'step' | 'recurrence' | 'reminder' | 'approval';
  projectStep?: boolean; stepLine?: number; stepSource?: string;
  dueAt?: number; priority?: number; importance?: number; order?: number;
  canComplete?: boolean; recurrenceId?: string; urgent?: boolean; required?: boolean; inProgress?: boolean; want?: boolean;
};
/** Explicit owner actions mentioning autopay still need action; notices do not. */
export function isAutomaticOccurrence(title: string) {
  if (/(?:^|[—–:;!?]\s*| - )(check|confirm|review|cancel|stop|change|update|enable|disable|set up|pay|move|transfer|ensure|verify|decide|renew|call|contact|approve)\b/i.test(title.trim())) return false;
  return /\bauto[ -]?(pay(?:ment)?s?|renew(?:s|al)?)\b|\bautomatically (?:renews|processes|charges|deducts)\b/i.test(title);
}

/** Conservative evidence of a single owner action, not a duration estimate. */
export function isConcreteAction(title: string) {
  const text = title.trim();
  return text.length <= 160 && text.split(/\s+/).length <= 22
    && /^(call|email|reply|send|ask|book|schedule|pay|renew|register|submit|choose|decide|approve|confirm|check|compare|review|read|sign|buy|order|pick up|drop off|contact)\b/i.test(text)
    && !/\b(and|then|pipeline|campaigns?|entire|all|overhaul|end.to.end)\b|[;\n]/i.test(text);
}

// Only use a step explicitly recorded in the task. Do not skip an earlier
// unfinished step just because a later one sounds easier.
export function nextRecordedStep(description?: string) {
  const lines = (description ?? '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*[-*] \[ \] (.+?)\s*$/.exec(lines[index]!);
    if (match) return isConcreteAction(match[1]!) ? { title: match[1]!, stepLine: index, stepSource: lines[index]! } : null;
  }
  return null;
}

export type BusyEvent = { startAt: number; endAt: number; isAllDay?: boolean; status?: string; isMaster?: boolean };

export function remainingBusyMinutes(events: BusyEvent[], from: number, to: number) {
  const spans = events.filter(e => e.status !== 'cancelled' && !e.isMaster && !e.isAllDay)
    .map(e => [Math.max(from, e.startAt), Math.min(to, e.endAt)] as [number, number])
    .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let end = from, total = 0;
  for (const [start, stop] of spans) { total += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
  return total / 60000;
}

export function selectToday(candidates: TodayCandidate[], events: BusyEvent[], now: number, dayEnd: number) {
  const unique = [...new Map(candidates.map(c => [`${c.kind}:${c.id}`, c])).values()]
    .filter(c => c.dueAt === undefined || c.dueAt < dayEnd || c.required || c.urgent || c.kind === 'recurrence');
  const due = (c: TodayCandidate) => !c.want && c.dueAt !== undefined && c.dueAt < dayEnd;
  const must = (c: TodayCandidate) => !c.projectStep && (c.required || c.urgent || due(c));
  unique.sort((a, b) => Number(!!must(b)) - Number(!!must(a)) || Number(!!b.urgent) - Number(!!a.urgent)
    || (due(a) ? a.dueAt! : Infinity) - (due(b) ? b.dueAt! : Infinity)
    || (b.importance ?? 0) - (a.importance ?? 0) || (b.priority ?? 0) - (a.priority ?? 0)
    || Number(!!b.inProgress) - Number(!!a.inProgress) || Number(!!a.want) - Number(!!b.want)
    || (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id));
  const busy = remainingBusyMinutes(events, now, dayEnd);
  // A conservative count, not invented duration estimates or calendar bookings.
  const calendarTarget = busy >= 240 ? 1 : busy >= 120 ? 2 : 3;
  const remainingHours = Math.max(0, (dayEnd - now) / 3600000 - busy / 60);
  const target = Math.max(0, Math.min(calendarTarget, Math.floor(remainingHours)));
  const mandatory = unique.filter(must);
  const personal = unique.filter(c => !must(c) && !c.projectStep).slice(0, Math.max(0, target - mandatory.length));
  const project = unique.find(c => c.projectStep);
  const items = [...mandatory, ...personal];
  if (project && items.length < target) items.push(project);
  const appointmentCount = events.filter(e => e.status !== 'cancelled' && !e.isMaster && e.endAt > now && e.startAt < dayEnd).length;
  const schedule = appointmentCount ? `${appointmentCount} appointment${appointmentCount === 1 ? '' : 's'} ${appointmentCount === 1 ? 'remains' : 'remain'} today.` : 'No appointments remain on your calendar today.';
  const action = items.length ? `Start with “${items[0]!.title}”${items.length > 1 ? `, then “${items[1]!.title}”` : ''}${mandatory.length > target ? '; today has more commitments than a light plan can fit' : ''}.` : unique.length && target === 0 ? 'Leave discretionary tasks for another day; little unscheduled time remains.' : 'There are no actions to recommend from your current records.';
  return { items, summary: `${schedule} ${action}`, busyMinutes: busy, overflow: mandatory.length > target };
}
