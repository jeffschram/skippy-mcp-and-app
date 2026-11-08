import { describe, it, expect } from "vitest";
import * as knowledge from "./knowledge";
import * as interviews from "./interviews";

type Row = Record<string, any>;
// Exercise the real handlers against an isolated database double. Legacy table
// reads/writes fail immediately, so canonical flows cannot silently fall back.
function fixture() {
  const rows: Row[] = [
    { _id: "brainInstances:b", ownerUserId: "users:u" },
    { _id: "users:u", displayName: "Test" },
  ];
  let sequence = 0;
  const field = (r: Row, key: string): any =>
    key.split(".").reduce((a, k) => a?.[k], r);
  const forbidden = (table: string) => {
    if (["notes", "links", "knowledgeObjects", "memories"].includes(table))
      throw Error(`legacy table accessed: ${table}`);
  };
  const db: any = {
    get: async (id: string) => rows.find((r) => r._id === id) ?? null,
    normalizeId: (table: string, id: string) =>
      id.startsWith(table + ":") ? id : null,
    insert: async (table: string, data: Row) => {
      forbidden(table);
      const _id = `${table}:${++sequence}`;
      rows.push({ ...data, _id });
      return _id;
    },
    patch: async (id: string, data: Row) => {
      const row = rows.find((r) => r._id === id);
      if (!row) throw Error("missing row");
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined) delete row[k];
        else row[k] = v;
      }
    },
    delete: async (id: string) => {
      const i = rows.findIndex((r) => r._id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    query: (table: string) => {
      forbidden(table);
      let matches = rows.filter((r) => r._id.startsWith(table + ":"));
      const range: any = {};
      for (const op of ["eq", "gte", "gt", "lt", "lte"])
        range[op] = (key: string, value: any) => {
          matches = matches.filter((r) =>
            op === "eq"
              ? field(r, key) === value
              : op === "gte"
                ? field(r, key) >= value
                : op === "gt"
                  ? field(r, key) > value
                  : op === "lt"
                    ? field(r, key) < value
                    : field(r, key) <= value,
          );
          return range;
        };
      const expressions: any = {
        field: (key: string) => (r: Row) => field(r, key),
      };
      const resolve = (v: any, r: Row) => (typeof v === "function" ? v(r) : v);
      expressions.eq = (a: any, b: any) => (r: Row) =>
        resolve(a, r) === resolve(b, r);
      expressions.neq = (a: any, b: any) => (r: Row) =>
        resolve(a, r) !== resolve(b, r);
      expressions.and =
        (...xs: any[]) =>
        (r: Row) =>
          xs.every((x) => resolve(x, r));
      expressions.or =
        (...xs: any[]) =>
        (r: Row) =>
          xs.some((x) => resolve(x, r));
      const chain: any = {
        withIndex: (_n: string, cb: any) => {
          if (cb) cb(range);
          return chain;
        },
        filter: (cb: any) => {
          matches = matches.filter(cb(expressions));
          return chain;
        },
        order: () => chain,
        take: async (n: number) => matches.slice(0, n),
        collect: async () => matches,
        paginate: async ({ numItems, cursor }: any) => {
          const start = cursor ? matches.findIndex(r => r._id === cursor) + 1 : 0;
          const page = matches.slice(start, start + numItems);
          return { page, isDone: start + numItems >= matches.length, continueCursor: page.at(-1)?._id ?? cursor ?? "" };
        },
        first: async () => matches[0] ?? null,
        unique: async () => matches[0] ?? null,
      };
      return chain;
    },
  };
  return { rows, db };
}
const run = (fn: unknown, ctx: any, args: Row): Promise<any> =>
  (fn as any)._handler(ctx, args);
const brainInstanceId = "brainInstances:b";
async function drain(ctx: any) {
  for (let batch = 0; batch < 50; batch++) {
    if ((await run(knowledge.acceptRetiredReviewQueue, ctx, { brainInstanceId })).done) return;
  }
  throw Error("Migration failed to finish");
}
const payloads = {
  note: { title: "Note", body: "A durable note" },
  link: {
    url: "https://example.com/reference",
    title: "Link",
    status: "saved",
  },
  knowledgeObject: {
    objectType: "reference",
    title: "Object",
    properties: { topic: "test" },
  },
};
describe("canonical Knowledge paths after dual-write retirement", () => {
  for (const [kind, payload] of Object.entries(payloads)) {
    it(`direct ${kind} ingestion preserves kind, content and provenance`, async () => {
      const ctx = fixture();
      const result = await run(knowledge.ingestObject, ctx, {
        brainInstanceId,
        candidateEntityType: kind,
        candidatePayload: payload,
        rubricDecision: "verification",
        sourceRefs: [{ sourceSystem: "verification", messageId: "source-1" }],
      });
      const row = ctx.rows.find((r) => r._id === result.entityId)!;
      expect(row.kind).toBe(kind === "knowledgeObject" ? "note" : kind);
      expect(row.processingState).toBe("accepted");
      expect(row.title).toBe(payload.title);
      for (const [field, value] of Object.entries(payload)) {
        expect(row[field]).toEqual(value);
      }
      expect(row.sourceRefIds).toHaveLength(1);
      expect(
        ctx.rows.find((r) => r._id === row.sourceRefIds[0])?.messageId,
      ).toBe("source-1");
      if (kind === "link") {
        await run(knowledge.updateLinkStatusForBrain, ctx, {
          brainInstanceId,
          linkId: row._id,
          status: "read",
        });
        expect(row.status).toBe("read");
      }
    });
    it(`queue migration creates canonical ${kind} with a valid candidate pointer`, async () => {
      const ctx = fixture();
      const id = await ctx.db.insert("triageItems", {
        brainInstanceId,
        candidateEntityType: kind,
        candidatePayload: payload,
        status: "pending",
        createdAt: 1,
        sourceRefIds: [],
      });
      await drain(ctx);
      const candidate = ctx.rows.find(r => r._id === id)!;
      expect(ctx.rows.find(r => r._id === candidate.candidateEntityId)?.kind).toBe(kind === "knowledgeObject" ? "note" : kind);
      const snapshot = JSON.stringify(ctx.rows);
      expect(await run(knowledge.acceptRetiredReviewQueue, ctx, { brainInstanceId })).toEqual({ triageAccepted: 0, memoriesAccepted: 0, done: true });
      expect(JSON.stringify(ctx.rows)).toBe(snapshot);
    });
  }
  it("accepts legacy submissions into notes with full properties", async () => {
    const ctx = fixture();
    const result = await run(knowledge.submitCandidateObject, ctx, {
      brainInstanceId, candidateEntityType: "knowledgeObject",
      candidatePayload: { title: "Legacy reference", properties: { body: "Original full text", tags: ["home"] } },
    });
    const candidate = ctx.rows.find(r => r._id === result.entityId)!;
    expect(candidate.kind).toBe("note");
    expect(candidate.body).toBe("Original full text");
    expect(candidate.properties.tags).toEqual(["home"]);
  });
  it("captures, links, retrieves and isolates memories by brain", async () => {
    const ctx = fixture();
    const projectId = await ctx.db.insert("projects", {
      brainInstanceId,
      title: "Project",
      processingState: "accepted",
    });
    const result = await run(knowledge.recordMemoryForBrain, ctx, {
      brainInstanceId,
      content: "Remember the decision",
      title: "Decision",
      rubricDecision: "verification",
      relatedEntityRefs: [{ entityType: "project", entityId: projectId }],
    });
    const memoryId = result.memoryId;
    expect(ctx.rows.find((r) => r._id === memoryId)?.kind).toBe("memory");
    const detail = await run(knowledge.memoryDetailForBrain, ctx, {
      brainInstanceId,
      memoryId,
    });
    expect(detail.memory.body).toBe("Remember the decision");
    expect(detail.relatedEntities).toHaveLength(1);
    expect(ctx.rows.find(r => r._id.startsWith("relationships:"))?.from.entityType).toBe("memory");
    expect(
      await run(knowledge.memoryDetailForBrain, ctx, {
        brainInstanceId: "brainInstances:other",
        memoryId,
      }),
    ).toBeNull();
  });
  it("interview answers accept canonical memories", async () => {
    const ctx = fixture();
    const started = await run(interviews.startForBrain, ctx, {
      brainInstanceId,
      kind: "decision",
      title: "Test interview",
    });
    let answered: any;
    for (let i = 0; i < started.interview.questionCount; i++) {
      answered = await run(interviews.answerCurrentQuestionForBrain, ctx, {
        brainInstanceId,
        interviewId: started.interviewId,
        answerText: "We need a durable decision",
        createMemoryCandidate: true,
      });
      if (answered.memoryCandidateId) break;
    }
    const row = ctx.rows.find((r) => r._id === answered.memoryCandidateId);
    expect(row?.kind).toBe("memory");
    expect(row?.reviewState).toBe("accepted");
    expect(row?.processingState).toBe("accepted");
  });
});

describe("review retirement", () => {
  it.each(["accept", "auto", "submit_for_review"])("accepts memory and thoughts for %s", async reviewBehavior => {
    for (const [fn, input] of [
      [knowledge.captureThoughtForBrain, { text: "Remember this" }],
      [knowledge.recordMemoryForBrain, { content: "Remember this", rubricDecision: "Durable" }],
      [knowledge.submitMemoryReviewCandidateForBrain, { content: "Remember this" }],
    ] as const) {
      const ctx = fixture();
      const result = await run(fn, ctx, { brainInstanceId, ...input, reviewBehavior });
      const memory = ctx.rows.find(row => row._id === result.memoryId);
      expect(memory).toMatchObject({ status: "accepted", processingState: "accepted", reviewState: "accepted" });
      expect(ctx.rows.some(row => row._id.startsWith("triageItems:"))).toBe(false);
    }
  });
  it.each(["drafted", "pending_approval"])("halts before writes for %s external actions, even in another brain", async status => {
    const ctx = fixture();
    await ctx.db.insert("pendingActions", { brainInstanceId: "other", status });
    await ctx.db.insert("knowledge", { brainInstanceId, kind: "memory", status: "inbox", createdAt: 1 });
    const snapshot = JSON.stringify(ctx.rows);
    await expect(drain(ctx)).rejects.toThrow("Migration halted");
    expect(JSON.stringify(ctx.rows)).toBe(snapshot);
  });
  it("accepts the memory union, preserving provenance and excluding resolved/unrelated records", async () => {
    const ctx = fixture();
    const ids = [];
    for (const [status, reviewState] of [["inbox", "unreviewed"], ["inbox", "pending_review"], ["accepted", "pending_review"]]) {
      ids.push(await ctx.db.insert("knowledge", { brainInstanceId, kind: "memory", status, reviewState, processingState: "suggested", body: "Original", sourceRefIds: ["sourceRefs:1"], createdAt: 1 }));
    }
    const untouched = [];
    for (const extra of [{ status: "archived" }, { processingState: "rejected" }, { reviewState: "archived" }, { kind: "note" }, { brainInstanceId: "other" }]) {
      const id = await ctx.db.insert("knowledge", { brainInstanceId, kind: "memory", status: "inbox", reviewState: "pending_review", createdAt: 1, ...extra });
      untouched.push({ ...await ctx.db.get(id) });
    }
    const actionId = await ctx.db.insert("pendingActions", { brainInstanceId, status: "approved" });
    await drain(ctx);
    for (const id of ids) expect(await ctx.db.get(id)).toMatchObject({ status: "accepted", processingState: "accepted", reviewState: "accepted", body: "Original", sourceRefIds: ["sourceRefs:1"] });
    for (const row of untouched) expect(await ctx.db.get(row._id)).toEqual(row);
    expect(await ctx.db.get(actionId)).toEqual({ _id: actionId, brainInstanceId, status: "approved" });
    const snapshot = JSON.stringify(ctx.rows);
    await drain(ctx);
    expect(JSON.stringify(ctx.rows)).toBe(snapshot);
  });
});

it("resumes bounded migration pages with a fixed cutoff and rechecks the action guard", async () => {
  const ctx = fixture();
  for (let i = 0; i < 26; i++) await ctx.db.insert("triageItems", { brainInstanceId, candidateEntityType: "note", candidatePayload: { title: `Note ${i}`, body: "Source" }, status: "pending", createdAt: 1 });
  for (let i = 0; i < 105; i++) await ctx.db.insert("knowledge", { brainInstanceId, kind: "memory", status: "inbox", createdAt: 1 });
  const first = await run(knowledge.acceptRetiredReviewQueue, ctx, { brainInstanceId });
  expect(first).toMatchObject({ triageAccepted: 25, memoriesAccepted: 0, done: false });
  const progress = ctx.rows.find(row => row.version === "retire-review-v1")!;
  const late = await ctx.db.insert("knowledge", { brainInstanceId, kind: "memory", status: "inbox", createdAt: progress.cutoff + 1 });
  const blocker = await ctx.db.insert("pendingActions", { brainInstanceId, status: "drafted" });
  await expect(drain(ctx)).rejects.toThrow("Migration halted");
  await ctx.db.delete(blocker);
  await drain(ctx);
  expect(progress).toMatchObject({ triageAccepted: 26, memoriesAccepted: 105, triageDone: true, memoryDone: true });
  expect((await ctx.db.get(late)).status).toBe("inbox");
});

it("paginates owned Activity and action history without exposing another brain", async () => {
  const ctx = fixture();
  await ctx.db.patch("users:u", { authProvider: "clerk", authUserId: "owner" });
  const viewer = { ...ctx, auth: { getUserIdentity: async () => ({ subject: "owner" }) } };
  const ownAction = await ctx.db.insert("pendingActions", { brainInstanceId, status: "approved", reviewWarning: "Overlap", createdAt: 1 });
  const foreignAction = await ctx.db.insert("pendingActions", { brainInstanceId: "other", status: "failed", error: "Private" });
  await ctx.db.insert("activityEvents", { brainInstanceId, pendingActionId: ownAction, summary: "Queued", timestamp: 1 });
  await ctx.db.insert("activityEvents", { brainInstanceId, pendingActionId: foreignAction, summary: "Legacy reference", timestamp: 2 });
  await ctx.db.insert("activityEvents", { brainInstanceId: "other", summary: "Private", timestamp: 3 });
  const args = { paginationOpts: { numItems: 1, cursor: null } };
  const first = await run(knowledge.activityForViewer, viewer, args);
  expect(first.page).toHaveLength(1);
  expect(first.page[0]).toMatchObject({ summary: "Queued", actionStatus: "approved", warning: "Overlap" });
  const second = await run(knowledge.activityForViewer, viewer, { paginationOpts: { numItems: 1, cursor: first.continueCursor } });
  expect(second.page[0]).toMatchObject({ summary: "Legacy reference", actionStatus: null, error: null });
  const actions = await run(knowledge.actionHistoryForViewer, viewer, args);
  expect(actions.page.map((row: Row) => row._id)).toEqual([ownAction]);
  await expect(run(knowledge.activityForViewer, { ...ctx, auth: { getUserIdentity: async () => null } }, args)).rejects.toThrow("authentication required");
});
