import { describe, it, expect } from 'vitest';
import { mergeHomeRows, splitHomeRows, homeBounds } from './home-period-helpers';
import type { AgendaItem } from '@skippy/shared';
import type { TodayCandidate } from '../../../../convex/todayModel';
const now = new Date(2026, 10, 5, 10).getTime();
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const event = (id: string, day: number): AgendaItem => ({ id, title: id, source: 'event', at: at(day) });
const action = (id: string, extra: Partial<TodayCandidate> = {}): TodayCandidate => ({ id, title: id, kind: 'task', href: '/tasks', canComplete: true, ...extra });
describe('Home periods', () => {
  it('shows today separately and includes every day tomorrow through day seven only', () => {
    const result = splitHomeRows([], [], [event('today', 5), event('tomorrow', 6), event('last day', 12), event('too late', 13)], now, zone);
    expect(result.today.map(r => r.title)).toEqual(['today']);
    expect(result.week.map(r => r.title)).toEqual(['tomorrow', 'last day']);
    expect(homeBounds(now).weekEnd).toBe(at(13, 0));
  });
  it('keeps all-day UTC dates on their calendar day at a local boundary', () => {
    const laNow = new Date('2026-11-05T10:00:00-08:00').getTime();
    // Build the local bounds in the same timezone the browser uses for this test.
    const prior = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const result = splitHomeRows([], [], [{ source: 'event', id: 'all-day', title: 'Holiday', at: Date.parse('2026-11-06T00:00:00Z'), isAllDay: true }], laNow, 'America/Los_Angeles');
      expect(result.today).toHaveLength(0);
      expect(result.week.map(r => r.title)).toEqual(['Holiday']);
      const dst = homeBounds(new Date('2026-10-31T10:00:00-07:00').getTime());
      expect(dst.weekEnd - dst.dayEnd).toBe(7 * 86400000 + 3600000);
    } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
  });
  it('merges due tasks with recommendations and removes cross-card repeats', () => {
    const a = action('pay');
    const result = splitHomeRows([a], [a, action('choose')], [{ source: 'task', id: 'pay', title: 'pay', at: at(5) }], now, zone);
    expect(result.today).toHaveLength(1);
    expect(result.today[0]?.scheduled).toBeDefined();
    expect(result.week.map(r => r.title)).toEqual(['choose']);
  });
  it('keeps appointments and automatic payments informational while preserving genuine actions', () => {
    const rows = mergeHomeRows([], [event('appointment', 5), { source: 'recurrence', id: 'auto', title: 'GEICO auto-pay processes', at: now }, { source: 'task', id: 'check', title: 'Chase checking is low — move money before upcoming auto-payments', at: now }]);
    expect(rows.find(r => r.key === 'event:appointment')?.action).toBeUndefined();
    expect(rows.find(r => r.key === 'recurrence:auto')?.action).toBeUndefined();
    expect(rows.find(r => r.key === 'task:check')?.action?.canComplete).toBe(true);
  });
  it('keeps recurrence completion identity for a spawned task and deduplicates its slot', () => {
    const rows = mergeHomeRows([action('spawned', { recurrenceId: 'r' })], [{ source: 'task', id: 'spawned', title: 'Renew filter', recurrenceId: 'r', at: now }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action?.recurrenceId).toBe('r');
    const scheduledOnly = mergeHomeRows([], [{ source: 'task', id: 'spawned', title: 'Renew filter', recurrenceId: 'r', at: now }]);
    expect(scheduledOnly[0]?.action?.recurrenceId).toBe('r');
  });
  it('does not give a parent-task completion to a recorded checklist step', () => {
    const rows = mergeHomeRows([action('project', { kind: 'step', canComplete: false, stepLine: 0, stepSource: '- [ ] Choose a font' })], [{ source: 'task', id: 'project', title: 'Big project', at: now }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action?.kind).toBe('step');
    expect(rows[0]?.action?.canComplete).toBe(false);
  });
});
