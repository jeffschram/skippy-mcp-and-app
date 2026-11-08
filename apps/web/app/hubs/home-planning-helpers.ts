export function homePeriods(now: number) {
  // Browser civil calendar arithmetic handles DST and rolling seven-day windows.
  const d = new Date(now);
  const day = (offset: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
  const utc = (offset: number) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  return { now, start: day(0), tomorrow: day(1), overdueStart: day(-7), weekEnd: day(8),
    horizon: day(365), utcToday: utc(0), utcTomorrow: utc(1), utcWeekEnd: utc(8) };
}
export function parseHomeHash(hash: string): { kind: "task" | "event" | "recurrence" | "review"; id: string } | null {
  const match = /^#(task|event|recurrence|review)-(.+)$/.exec(hash);
  return match ? { kind: match[1] as "task" | "event" | "recurrence" | "review", id: match[2]! } : null;
}
