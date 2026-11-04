import { describe, it, expect } from 'vitest';
import { selectToday, remainingBusyMinutes, type TodayCandidate } from './todayModel';
const now = 1800000000000, end = now + 8 * 3600000;
const task = (id: string, extra: Partial<TodayCandidate> = {}): TodayCandidate => ({ id, title: id, kind: 'task', href: '/', ...extra });
describe('daily selection', () => {
  it('selects important undated work without manual daily picking', () => {
    const result = selectToday(Array.from({ length: 8 }, (_, i) => task(String(i), { importance: i })), [], now, end);
    expect(result.items.map(x => x.id)).toEqual(['7', '6', '5', '4', '3']);
    expect(result.summary).toContain('“7”');
  });
  it('counts overlapping events once and ignores cancelled and all-day events for capacity', () => {
    expect(remainingBusyMinutes([{ startAt: now, endAt: now + 2 * 3600000 }, { startAt: now + 3600000, endAt: now + 3 * 3600000 }, { startAt: now, endAt: end, status: 'cancelled' }, { startAt: now, endAt: end, isAllDay: true }], now, end)).toBe(180);
  });
  it('reduces discretionary work on busy days while keeping real deadlines visible', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task(String(i), { dueAt: now - i }));
    const result = selectToday(tasks, [{ startAt: now, endAt: end }], now, end);
    expect(result.items).toHaveLength(8);
    expect(result.overflow).toBe(true);
    expect(selectToday(tasks.map(t => ({ ...t, dueAt: end + 1 })), [{ startAt: now, endAt: now + 4 * 3600000 }], now, end).items).toHaveLength(2);
  });
  it('does not fill a fully booked day with discretionary tasks', () => {
    expect(selectToday([task('optional')], [{ startAt: now, endAt: end }], now, end).items).toHaveLength(0);
  });
  it('does not turn a want into a mandatory deadline, and deduplicates records', () => {
    const want = task('want', { want: true, dueAt: now - 1 });
    const result = selectToday([want, want, task('obligation', { dueAt: now })], [], now, end);
    expect(result.items.map(x => x.id)).toEqual(['obligation', 'want']);
  });
  it('briefing updates from the selection when work disappears', () => {
    expect(selectToday([task('renewal')], [], now, end).summary).toContain('renewal');
    expect(selectToday([], [], now, end).summary).not.toContain('renewal');
  });
});
