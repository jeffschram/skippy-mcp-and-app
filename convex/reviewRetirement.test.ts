import { describe, it, expect } from 'vitest';
import { acceptMemoryBatch } from './reviewRetirement';
describe('retired memory review', () => {
  it('does not resurrect archived records or let them starve later batches', async () => {
    const rows: any[] = [{ _id: 'a', status: 'archived', processingState: 'archived', reviewState: 'pending_review' }, { _id: 'b', brainInstanceId: 'brain', title: 'Keep', status: 'inbox', processingState: 'suggested', reviewState: 'pending_review' }];
    const db = { query: () => { let state: string; const q: any = { eq: (key: string, value: string) => { if (key === 'reviewState') state = value; return q; } }; return { withIndex: (_: string, callback: any) => { callback(q); return { take: async () => rows.filter(r => r.reviewState === state) }; } }; }, patch: async (id: string, data: any) => Object.assign(rows.find(r => r._id === id), data), insert: async () => 'event' };
    const run = () => (acceptMemoryBatch as any)._handler({ db }, {});
    expect(await run()).toBe(1);
    expect(rows[0].status).toBe('archived');
    expect(rows[0].reviewState).toBe('archived');
    expect(rows[1].reviewState).toBe('accepted');
    expect(await run()).toBe(0);
  });
});
