import { agendaItemsAreDuplicates, type AgendaItem } from '@skippy/shared';
import { isAutomaticOccurrence, type TodayCandidate } from '../../../../convex/todayModel';

export type HomeRow = { key: string; title: string; action?: TodayCandidate; scheduled?: AgendaItem };
export function homeBounds(now: number) {
  const d = new Date(now);
  const at = (offset: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
  return { dayStart: at(0), dayEnd: at(1), weekEnd: at(8) };
}
export function homeDayKey(at: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
function actionKey(action: TodayCandidate) {
  return action.recurrenceId ? `recurrence:${action.recurrenceId}` : `${action.kind === 'step' ? 'task' : action.kind}:${action.id}`;
}
function scheduledKey(item: AgendaItem) {
  return item.recurrenceId ? `recurrence:${item.recurrenceId}` : `${item.source}:${item.id}`;
}
/** Merge by record identity, never create a second task for a scheduled action. */
export function mergeHomeRows(actions: TodayCandidate[], schedule: AgendaItem[]): HomeRow[] {
  const rows: HomeRow[] = actions.filter(a => !isAutomaticOccurrence(a.title)).map(action => ({ key: actionKey(action), title: action.title, action }));
  for (const item of schedule) {
    const key = scheduledKey(item);
    const existing = rows.find(row => row.key === key);
    if (existing) { existing.scheduled = item; continue; }
    // A calendar event can also have been captured as a task; show it once as an event.
    const duplicate = item.source === 'event' ? rows.findIndex(row => row.action?.dueAt !== undefined && agendaItemsAreDuplicates(
      { source: 'task', title: row.title, at: row.action.dueAt }, item,
    )) : -1;
    if (duplicate >= 0) rows.splice(duplicate, 1);
    const actionable = item.source !== 'event' && !isAutomaticOccurrence(item.title) && item.status !== 'waiting';
    const action: TodayCandidate | undefined = actionable ? {
      id: item.id, title: item.title, kind: item.source === 'recurrence' ? 'recurrence' : 'task', href: item.href ?? '/tasks', canComplete: true,
      ...(item.recurrenceId ? { recurrenceId: item.recurrenceId } : {}),
    } : undefined;
    rows.push({ key, title: item.title, scheduled: item, ...(action ? { action } : {}) });
  }
  // Undated recommendations retain their ranking; dated items follow in time order.
  return rows.sort((a, b) => (a.scheduled?.at ?? -Infinity) - (b.scheduled?.at ?? -Infinity));
}
export function splitHomeRows(actions: TodayCandidate[], weeklyActions: TodayCandidate[], schedule: AgendaItem[], now: number, timeZone: string) {
  const { dayStart, dayEnd, weekEnd } = homeBounds(now);
  const todayKey = homeDayKey(dayStart, timeZone), tomorrowKey = homeDayKey(dayEnd, timeZone), endKey = homeDayKey(weekEnd, timeZone);
  const key = (item: AgendaItem) => homeDayKey(item.at, item.isAllDay ? 'UTC' : timeZone);
  const today = mergeHomeRows(actions, schedule.filter(item => key(item) === todayKey));
  const todayIds = new Set([...today.map(row => row.key), ...actions.map(actionKey)]);
  const week = mergeHomeRows(weeklyActions, schedule.filter(item => key(item) >= tomorrowKey && key(item) < endKey)).filter(row => !todayIds.has(row.key));
  return { today, week };
}
