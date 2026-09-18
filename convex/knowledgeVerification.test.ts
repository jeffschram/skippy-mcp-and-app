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
    it(`review approval creates canonical ${kind} with a valid candidate pointer`, async () => {
      const ctx = fixture();
      const id = await ctx.db.insert("triageItems", {
        brainInstanceId,
        candidateEntityType: kind,
        candidatePayload: payload,
        status: "pending",
        sourceRefIds: [],
      });
      const result = await run(knowledge.approveTriageItem, ctx, {
        triageItemId: id,
      });
      expect(
        ctx.rows.find((r) => r._id === result.entityRef.entityId)?.kind,
      ).toBe(kind === "knowledgeObject" ? "note" : kind);
      expect(ctx.rows.find((r) => r._id === id)?.candidateEntityId).toBe(
        result.entityRef.entityId,
      );
      await expect(
        run(knowledge.approveTriageItem, ctx, { triageItemId: id }),
      ).rejects.toThrow("already been reviewed");
    });
  }
  it("routes legacy review submissions into note candidates with full properties", async () => {
    const ctx = fixture();
    const result = await run(knowledge.submitCandidateObject, ctx, {
      brainInstanceId, candidateEntityType: "knowledgeObject",
      candidatePayload: { title: "Legacy reference", properties: { body: "Original full text", tags: ["home"] } },
    });
    const candidate = ctx.rows.find(r => r._id === result.triageItemId)!;
    expect(candidate.candidateEntityType).toBe("note");
    expect(candidate.candidatePayload.body).toBe("Original full text");
    expect(candidate.candidatePayload.properties.tags).toEqual(["home"]);
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
  it("interview answers point to canonical review memories", async () => {
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
    expect(row?.reviewState).toBe("pending_review");
  });
});
