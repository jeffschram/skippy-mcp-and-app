export function homePeriods(now: number) {
  // Browser civil calendar arithmetic handles DST and Monday–Sunday weeks.
  const d = new Date(now);
  const day = (offset: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
  const utc = (offset: number) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  const untilMonday = 7 - ((d.getDay() + 6) % 7);
  return { now, start: day(0), tomorrow: day(1), overdueStart: day(-7), weekEnd: day(untilMonday),
    horizon: day(365), utcToday: utc(0), utcTomorrow: utc(1), utcWeekEnd: utc(untilMonday) };
}
export function parseHomeHash(hash: string): { kind: "task" | "event" | "recurrence"; id: string } | null {
  const match = /^#(task|event|recurrence)-(.+)$/.exec(hash);
  return match ? { kind: match[1] as "task" | "event" | "recurrence", id: match[2]! } : null;
}
