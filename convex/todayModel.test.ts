import { describe, it, expect } from 'vitest';
import { selectToday, remainingBusyMinutes, nextRecordedStep, isConcreteAction, type TodayCandidate } from './todayModel';
const now = 1800000000000, end = now + 8 * 3600000;
const task = (id: string, extra: Partial<TodayCandidate> = {}): TodayCandidate => ({ id, title: id, kind: 'task', href: '/', ...extra });
describe('daily selection', () => {
  it('selects important undated work without manual daily picking', () => {
    const result = selectToday(Array.from({ length: 8 }, (_, i) => task(String(i), { importance: i })), [], now, end);
    expect(result.items.map(x => x.id)).toEqual(['7', '6', '5']);
    expect(result.summary).toContain('“7”');
  });
  it('does not pull future obligations into today without an explicit reminder', () => {
    const result = selectToday([task('groceries next month', { dueAt: end + 20 * 86400000 }), task('scheduled today', { dueAt: end + 86400000, required: true }), task('renewal lead time', { kind: 'recurrence', dueAt: end + 86400000 })], [], now, end);
    expect(result.items.map(x => x.id)).toEqual(['scheduled today', 'renewal lead time']);
  });
  it('allows one project step only after obligations and personal actions', () => {
    const result = selectToday([task('project1', { projectStep: true, importance: 100 }), task('project2', { projectStep: true }), task('bill', { dueAt: now })], [], now, end);
    expect(result.items.map(x => x.id)).toEqual(['bill', 'project1']);
    expect(selectToday([task('project', { projectStep: true }), task('bill', { dueAt: now })], [{ startAt: now, endAt: now + 4 * 3600000 }], now, end).items.map(x => x.id)).toEqual(['bill']);
  });
  it('uses an explicit first unfinished action without inventing or skipping work', () => {
    expect(nextRecordedStep('- [x] Call Pat\n- [ ] Choose a font')).toMatchObject({ title: 'Choose a font', stepLine: 1 });
    expect(nextRecordedStep('- [ ] Build the pipeline\n- [ ] Choose a font')).toBeNull();
    expect(nextRecordedStep('A font will eventually be needed.')).toBeNull();
    expect(isConcreteAction('Register for taxes and turn on Stripe')).toBe(false);
    expect(isConcreteAction('Review the entire pipeline')).toBe(false);
  });
  it('counts overlapping events once and ignores cancelled and all-day events for capacity', () => {
    expect(remainingBusyMinutes([{ startAt: now, endAt: now + 2 * 3600000 }, { startAt: now + 3600000, endAt: now + 3 * 3600000 }, { startAt: now, endAt: end, status: 'cancelled' }, { startAt: now, endAt: end, isAllDay: true }], now, end)).toBe(180);
  });
  it('reduces discretionary work on busy days while keeping real deadlines visible', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task(String(i), { dueAt: now - i }));
    const result = selectToday(tasks, [{ startAt: now, endAt: end }], now, end);
    expect(result.items).toHaveLength(8);
    expect(result.overflow).toBe(true);
    expect(selectToday(tasks.map(({ dueAt, ...rest }) => rest), [{ startAt: now, endAt: now + 4 * 3600000 }], now, end).items).toHaveLength(1);
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
