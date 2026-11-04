import { v } from 'convex/values';
import { agendaItemsAreDuplicates } from '@skippy/shared';
import { query } from './_generated/server';
import { requireOwnedBrain } from './auth';
import { attentionHref, isAttentionArchived } from './attentionModel';
import { selectToday, type TodayCandidate } from './todayModel';

const item = v.object({ id: v.string(), title: v.string(), href: v.string(), kind: v.union(v.literal('task'), v.literal('recurrence'), v.literal('reminder'), v.literal('approval')), canComplete: v.optional(v.boolean()), recurrenceId: v.optional(v.string()), dueAt: v.optional(v.number()), priority: v.optional(v.number()), importance: v.optional(v.number()), order: v.optional(v.number()), urgent: v.optional(v.boolean()), required: v.optional(v.boolean()), inProgress: v.optional(v.boolean()), want: v.optional(v.boolean()) });
export const forViewer = query({
  args: { now: v.number(), dayStart: v.number(), dayEnd: v.number() },
  returns: v.object({ items: v.array(item), summary: v.string(), busyMinutes: v.number(), overflow: v.boolean(), limited: v.boolean() }),
  handler: async (ctx, { now, dayStart, dayEnd }) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (![now, dayStart, dayEnd].every(Number.isFinite) || dayEnd <= dayStart || now < dayStart || now >= dayEnd || dayEnd - dayStart > 26 * 3600000) throw new Error('Invalid day');
    const candidates: TodayCandidate[] = [];
    let limited = false;
    const tasks = new Map<string, any>();
    // Dedicated deadline queries ensure old obligations cannot be crowded out by newer work.
    for (const status of ['todo', 'in_progress', 'waiting'] as const) {
      const groups = await Promise.all([
        ctx.db.query('tasks').withIndex('by_brain_status_due', q => q.eq('brainInstanceId', brain._id).eq('processingState', 'accepted').eq('status', status).gt('dueAt', 0).lt('dueAt', dayEnd)).take(101),
        ctx.db.query('tasks').withIndex('by_brain_status', q => q.eq('brainInstanceId', brain._id).eq('status', status)).order('desc').take(101),
      ]);
      for (const rows of groups) { if (rows.length > 100) limited = true; for (const row of rows.slice(0, 100)) tasks.set(row._id, row); }
    }
    const prioritized = await ctx.db.query('tasks').withIndex('by_brain_state_priority', q => q.eq('brainInstanceId', brain._id).eq('processingState', 'accepted')).order('desc').take(101);
    if (prioritized.length > 100) limited = true;
    for (const row of prioritized.slice(0, 100)) tasks.set(row._id, row);
    for (const state of ['in_review', 'blocked'] as const) {
      const rows = await ctx.db.query('tasks').withIndex('by_brain_execution_state', q => q.eq('brainInstanceId', brain._id).eq('executionState', state)).take(101);
      if (rows.length > 100) limited = true;
      for (const row of rows.slice(0, 100)) tasks.set(row._id, row);
    }
    // Bound relationship traversal too, not only the top-level indexed reads.
    const ranked = [...tasks.values()].filter(task => task.processingState === 'accepted' && !['done', 'cancelled'].includes(task.status) && (task.ownerType !== 'agent' || ['in_review', 'blocked'].includes(task.executionState))).sort((a, b) =>
      Number(['in_review', 'blocked'].includes(b.executionState)) - Number(['in_review', 'blocked'].includes(a.executionState)) ||
      Number(b.commitment !== 'want' && b.dueAt < dayEnd) - Number(a.commitment !== 'want' && a.dueAt < dayEnd) ||
      (b.importanceScore ?? 0) - (a.importanceScore ?? 0) || (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
    if (ranked.length > 200) limited = true;
    for (const task of ranked.slice(0, 200)) {
      if (task.processingState !== 'accepted' || isAttentionArchived(task) || ['done', 'cancelled'].includes(task.status) || task.focusSnoozedUntil > now) continue;
      const a = task.attention ?? {};
      const overdue = task.commitment !== 'want' && task.dueAt < now;
      if (!overdue && (a.override === 'ok' || a.scheduledAt >= dayEnd)) continue;
      const decision = ['in_review', 'blocked'].includes(task.executionState);
      if (task.status === 'waiting' && !decision) continue;
      if (task.ownerType === 'agent' && !decision) continue;
      const links = await ctx.db.query('relationships').withIndex('by_brain_from', q => q.eq('brainInstanceId', brain._id).eq('from.entityId', task._id)).take(17);
      if (links.length > 16) { limited = true; continue; }
      let excluded = false;
      let href = attentionHref('task', task._id);
      let importance = task.importanceScore ?? 0;
      let priority = task.priorityScore ?? 0;
      for (const link of links) {
        if (link.type === 'belongs_to' && link.to.entityType === 'project') {
          const id = ctx.db.normalizeId('projects', link.to.entityId);
          const project = id ? await ctx.db.get(id) : null;
          if (!project || project.brainInstanceId !== brain._id || isAttentionArchived(project) || ['completed', 'cancelled'].includes(project.status)) excluded = true;
          else { href = `/projects/${project._id}#task-${task._id}`; importance = Math.max(importance, project.importanceScore ?? 0); priority = Math.max(priority, project.priorityScore ?? 0); }
        }
        if (['depends_on', 'blocked_by'].includes(link.type) && link.to.entityType === 'task' && !decision) {
          const id = ctx.db.normalizeId('tasks', link.to.entityId);
          const dependency = id ? await ctx.db.get(id) : null;
          if (!dependency || dependency.brainInstanceId !== brain._id || !['done', 'cancelled'].includes(dependency.status)) excluded = true;
        }
      }
      if (excluded) continue;
      candidates.push({ id: task._id, title: decision ? `${task.executionState === 'in_review' ? 'Review' : 'Unblock'}: ${task.title}` : task.title,
        href, kind: 'task', canComplete: !decision, ...(task.dueAt !== undefined ? { dueAt: task.dueAt } : {}),
        priority, importance, order: task.orderIndex ?? 9999,
        urgent: a.override === 'immediate', required: decision || (a.reviewAt > 0 && a.reviewAt < dayEnd) || (a.scheduledAt > 0 && a.scheduledAt < dayEnd), inProgress: task.status === 'in_progress', want: task.commitment === 'want' });
    }
    const recurrences = await ctx.db.query('recurrences').withIndex('by_brain_status', q => q.eq('brainInstanceId', brain._id).eq('status', 'active')).take(101);
    if (recurrences.length > 100) limited = true;
    for (const r of recurrences.slice(0, 100)) {
      if (r.nextDueAt - (r.leadTimeDays ?? 0) * 86400000 >= dayEnd) continue;
      const task = r.currentTaskId ? await ctx.db.get(r.currentTaskId) : null;
      if (task && task.brainInstanceId === brain._id && !['done', 'cancelled'].includes(task.status)) {
        const candidate = candidates.find(c => c.id === task._id);
        if (candidate) candidate.recurrenceId = r._id;
        continue;
      }
      candidates.push({ id: r._id, title: r.title, kind: 'recurrence', href: '/tasks', dueAt: r.nextDueAt });
    }
    // Retain explicit reminders on reference records when retiring Attention navigation.
    for (const table of ['goals', 'projects', 'people', 'companies', 'knowledge'] as const) {
      const groups = await Promise.all([
        ctx.db.query(table).withIndex('by_brain_review', q => q.eq('brainInstanceId', brain._id).eq('processingState', 'accepted').gt('attention.reviewAt', 0).lt('attention.reviewAt', dayEnd)).take(21),
        ctx.db.query(table).withIndex('by_brain_scheduled', q => q.eq('brainInstanceId', brain._id).eq('processingState', 'accepted').gt('attention.scheduledAt', 0).lt('attention.scheduledAt', dayEnd)).take(21),
        ...(['immediate', 'todo', 'stale'] as const).map(status => ctx.db.query(table).withIndex('by_brain_attention', q => q.eq('brainInstanceId', brain._id).eq('processingState', 'accepted').eq('attention.override', status)).take(21)),
      ]);
      for (const rows of groups) { if (rows.length > 20) limited = true; for (const row of rows.slice(0, 20)) {
        if (isAttentionArchived(row) || ['completed', 'cancelled', 'achieved', 'abandoned'].includes('status' in row ? row.status ?? '' : '') || row.attention?.override === 'ok') continue;
        const kind = table === 'knowledge' ? ('kind' in row && ['note', 'link', 'memory'].includes(row.kind ?? '') ? row.kind as 'note' | 'link' | 'memory' : 'note') : table === 'people' ? 'person' : table === 'companies' ? 'company' : table === 'goals' ? 'goal' : 'project';
        candidates.push({ id: row._id, title: `Revisit: ${('title' in row ? row.title : 'name' in row ? row.name : undefined) || 'Saved item'}`, kind: 'reminder', href: attentionHref(kind, row._id), required: true });
      } }
    }
    for (const status of ['pending_approval', 'drafted', 'failed'] as const) {
      const rows = await ctx.db.query('pendingActions').withIndex('by_brain_status', q => q.eq('brainInstanceId', brain._id).eq('status', status)).take(21);
      if (rows.length > 20) limited = true;
      for (const action of rows.slice(0, 20)) candidates.push({ id: action._id, title: `Discuss: ${action.subject || action.actionType}`, kind: 'approval', href: '/?chat=1', required: true });
    }
    const events = await ctx.db.query('calendarEvents').withIndex('by_brain_end', q => q.eq('brainInstanceId', brain._id).gt('endAt', dayStart)).take(501);
    if (events.length > 500) limited = true;
    const activeEvents = events.slice(0, 500).filter(e => e.startAt < dayEnd && e.endAt > dayStart && e.status !== 'cancelled' && !e.isMaster);
    const uniqueEvents = activeEvents.filter((event, index) => !activeEvents.slice(0, index).some(other => agendaItemsAreDuplicates(
      { source: 'event', title: event.title, at: event.startAt }, { source: 'event', title: other.title, at: other.startAt },
    )));
    return { ...selectToday(candidates, uniqueEvents, now, dayEnd), limited };
  },
});
