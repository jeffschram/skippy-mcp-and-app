import { v } from 'convex/values';
import { agendaItemsAreDuplicates } from '@skippy/shared';
import { mutation, query } from './_generated/server';
import { requireOwnedBrain } from './auth';
import { attentionHref, isAttentionArchived } from './attentionModel';
import { isAutomaticOccurrence, isConcreteAction, nextRecordedStep, selectToday, type TodayCandidate } from './todayModel';

const item = v.object({ id: v.string(), title: v.string(), href: v.string(), kind: v.union(v.literal('task'), v.literal('step'), v.literal('recurrence'), v.literal('reminder'), v.literal('approval')), projectStep: v.optional(v.boolean()), stepLine: v.optional(v.number()), stepSource: v.optional(v.string()), canComplete: v.optional(v.boolean()), recurrenceId: v.optional(v.string()), dueAt: v.optional(v.number()), priority: v.optional(v.number()), importance: v.optional(v.number()), order: v.optional(v.number()), urgent: v.optional(v.boolean()), required: v.optional(v.boolean()), inProgress: v.optional(v.boolean()), want: v.optional(v.boolean()) });
export const forViewer = query({
  args: { now: v.number(), dayStart: v.number(), dayEnd: v.number(), period: v.optional(v.union(v.literal('today'), v.literal('week'))) },
  returns: v.object({ items: v.array(item), summary: v.string(), busyMinutes: v.number(), overflow: v.boolean(), limited: v.boolean() }),
  handler: async (ctx, { now, dayStart, dayEnd, period = 'today' }) => {
    const { brain } = await requireOwnedBrain(ctx);
    if (![now, dayStart, dayEnd].every(Number.isFinite) || dayEnd <= dayStart || now >= dayEnd
      || (period === 'today' ? now < dayStart || dayEnd - dayStart > 26 * 3600000
        : dayStart <= now || dayStart - now > 26 * 3600000 || dayEnd - dayStart > 7 * 86400000 + 3600000)) throw new Error('Invalid period');
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
      if (isAutomaticOccurrence(task.title)) continue;
      const a = task.attention ?? {};
      const overdue = task.commitment !== 'want' && task.dueAt < now;
      if (!overdue && (a.override === 'ok' || a.scheduledAt >= dayEnd)) continue;
      const decision = ['in_review', 'blocked'].includes(task.executionState);
      if (task.status === 'waiting' && !decision) continue;
      if (task.ownerType === 'agent' && !decision) continue;
      const links = await ctx.db.query('relationships').withIndex('by_brain_from', q => q.eq('brainInstanceId', brain._id).eq('from.entityId', task._id)).take(17);
      if (links.length > 16) { limited = true; continue; }
      let excluded = false;
      let projectWork = !!task.phaseId || ['coding', 'design', 'research', 'planning'].includes(task.kind);
      let href = attentionHref('task', task._id);
      let importance = task.importanceScore ?? 0;
      let priority = task.priorityScore ?? 0;
      for (const link of links) {
        if (link.type === 'belongs_to' && link.to.entityType === 'project') {
          projectWork = true;
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
      const required = decision || (a.reviewAt > 0 && a.reviewAt < dayEnd) || (a.scheduledAt > 0 && a.scheduledAt < dayEnd);
      const deadline = task.commitment !== 'want' && task.dueAt < dayEnd;
      const urgent = a.override === 'immediate';
      const step = !decision && projectWork ? nextRecordedStep(task.description) : null;
      // A deadline on a whole initiative needs a decision, not a checkbox that
      // pretends the initiative can be finished today.
      const hasChecklist = /^\s*[-*] \[[ xX]\] /m.test(task.description ?? '');
      const concrete = (!hasChecklist && isConcreteAction(task.title)) || (!projectWork && deadline);
      const needsPlan = !decision && ((projectWork && (deadline || urgent || required)) || (!step && !concrete && (required || deadline || urgent)));
      if (!decision && !step && !concrete && !needsPlan) continue;
      const title = decision ? `${task.executionState === 'in_review' ? 'Review' : 'Unblock'}: ${task.title}`
        : needsPlan ? `Decide the next action for: ${task.title}` : step?.title ?? task.title;
      candidates.push({ id: task._id, title, href, kind: step && !needsPlan ? 'step' : 'task', canComplete: !decision && !needsPlan && !step,
        ...(step && !needsPlan ? { stepLine: step.stepLine, stepSource: step.stepSource } : {}),
        projectStep: projectWork && !decision && !needsPlan,
        ...(task.dueAt !== undefined ? { dueAt: task.dueAt } : {}),
        priority, importance, order: task.orderIndex ?? 9999,
        urgent, required: required || needsPlan, inProgress: task.status === 'in_progress', want: task.commitment === 'want' });
    }
    const recurrences = await ctx.db.query('recurrences').withIndex('by_brain_status', q => q.eq('brainInstanceId', brain._id).eq('status', 'active')).take(101);
    if (recurrences.length > 100) limited = true;
    for (const r of recurrences.slice(0, 100)) {
      if (isAutomaticOccurrence(r.title)) continue;
      if (r.nextDueAt - (r.leadTimeDays ?? 0) * 86400000 >= dayEnd) continue;
      const task = r.currentTaskId ? await ctx.db.get(r.currentTaskId) : null;
      if (task && task.brainInstanceId === brain._id && !['done', 'cancelled'].includes(task.status)) {
        const candidate = candidates.find(c => c.id === task._id);
        if (candidate && candidate.stepLine === undefined) candidate.recurrenceId = r._id;
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
    return { ...selectToday(period === 'week' ? candidates.filter(c => c.dueAt === undefined || c.dueAt >= dayStart) : candidates, uniqueEvents, now, dayEnd), limited };
  },
});

/** Complete the recorded checklist step only; parent status and dependencies stay intact. */
export const completeStepForViewer = mutation({
  args: { taskId: v.id('tasks'), stepLine: v.number(), stepSource: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, stepLine, stepSource }) => {
    const { brain, user } = await requireOwnedBrain(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.brainInstanceId !== brain._id) throw new Error('Task not found');
    if (task.processingState !== 'accepted' || ['done', 'cancelled', 'waiting'].includes(task.status)
      || task.ownerType === 'agent' || ['in_review', 'blocked'].includes(task.executionState ?? '')) throw new Error('This task is not available for step completion');
    const lines = (task.description ?? '').split('\n');
    if (!Number.isInteger(stepLine) || stepLine < 0 || stepLine >= lines.length) throw new Error('This step has changed. Refresh Today.');
    const completedLine = stepSource.replace('[ ]', '[x]');
    if (lines[stepLine] === completedLine && completedLine !== stepSource) return null;
    const step = nextRecordedStep(task.description);
    if (!step || step.stepLine !== stepLine || step.stepSource !== stepSource) throw new Error('This step has changed. Refresh Today.');
    lines[stepLine] = completedLine;
    const now = Date.now();
    await ctx.db.patch(taskId, { description: lines.join('\n'), updatedAt: now });
    await ctx.db.insert('activityEvents', { brainInstanceId: brain._id, entityRef: { entityType: 'task', entityId: taskId },
      activityType: 'task_step_completed', actorType: 'user', actorId: user._id, timestamp: now, summary: `Completed step: ${step.title}` });
    return null;
  },
});
