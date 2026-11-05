import { v } from 'convex/values';
import { internalAction, internalQuery, internalMutation } from './_generated/server';
import { makeFunctionReference } from 'convex/server';

export const pendingBatch = internalQuery({ args: {}, returns: v.array(v.id('triageItems')), handler: async ({ db }) =>
  (await db.query('triageItems').withIndex('by_status', q => q.eq('status', 'pending')).take(20)).map(r => r._id),
});
export const acceptMemoryBatch = internalMutation({ args: {}, returns: v.number(), handler: async ({ db }) => {
  let count = 0;
  for (const state of ['pending_review', 'unreviewed'] as const) {
    const rows = await db.query('knowledge').withIndex('by_kind_review_state', q => q.eq('kind', 'memory').eq('reviewState', state)).take(20);
    for (const row of rows) {
      if (['archived', 'rejected'].includes(row.status ?? '') || ['archived', 'rejected'].includes(row.processingState)) {
        await db.patch(row._id, { reviewState: row.processingState === 'rejected' || row.status === 'rejected' ? 'rejected' : 'archived' });
        continue;
      }
      await db.patch(row._id, { status: 'accepted', processingState: 'accepted', reviewState: 'accepted', acceptedAt: Date.now(), reviewedAt: Date.now(), updatedAt: Date.now() });
      await db.insert('activityEvents', { brainInstanceId: row.brainInstanceId, activityType: 'review_retired', actorType: 'system', timestamp: Date.now(), summary: `Retained memory automatically: ${row.title || 'Untitled'}`, entityRef: { entityType: 'memory', entityId: row._id } });
      count++;
    }
  }
  return count;
} });
export const drain = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const ids: string[] = await ctx.runQuery(makeFunctionReference<'query'>('reviewRetirement:pendingBatch'), {});
  for (const id of ids) {
    try {
      const result = await ctx.runMutation(makeFunctionReference<'mutation'>('knowledge:retireReviewItem'), { id });
      if (result?.needsReference) await ctx.runMutation(makeFunctionReference<'mutation'>('knowledge:retainUnclassifiedReviewItem'), { id });
    } catch {
      // Retry failed transactions next pass; never reclassify on an outage.
      console.error('Review retirement will retry item', id);
    }
  }
  await ctx.runMutation(makeFunctionReference<'mutation'>('reviewRetirement:acceptMemoryBatch'), {});
  return null;
} });
