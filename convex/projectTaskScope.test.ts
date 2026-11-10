import { describe, expect, it } from "vitest";
import { codeProjectTaskIds, isCodeProject } from "./projectTaskScope";

type Row = Record<string, any>;

/**
 * Minimal db stub: the helper only reaches for the belongs_to relationship
 * index and then `get`s each distinct project, so there is no need for the full
 * schema-aware fixture used by homeInventory.test.ts.
 */
function fixture(records: Row[]) {
  let gets = 0;
  return {
    get gets() {
      return gets;
    },
    db: {
      get: async (id: string) => {
        gets++;
        return records.find((row) => row._id === id) ?? null;
      },
      query: (table: string) => ({
        withIndex: (_name: string, cb: (q: any) => unknown) => {
          const q: Row = { eq: () => q };
          cb(q);
          return {
            collect: async () =>
              records.filter(
                (row) => row._id.startsWith(`${table}:`) && row.brainInstanceId === "mine",
              ),
          };
        },
      }),
    },
  };
}

const project = (id: string, kind?: string) => ({
  _id: `projects:${id}`,
  brainInstanceId: "mine",
  ...(kind ? { kind } : {}),
});

const belongsTo = (taskId: string, projectId: string) => ({
  _id: `relationships:${taskId}-${projectId}`,
  brainInstanceId: "mine",
  type: "belongs_to",
  from: { entityType: "task", entityId: `tasks:${taskId}` },
  to: { entityType: "project", entityId: `projects:${projectId}` },
});

describe("isCodeProject", () => {
  it("treats absent kind as general, matching agentWorkbench's fallback", () => {
    expect(isCodeProject({ kind: "code" })).toBe(true);
    expect(isCodeProject({ kind: "general" })).toBe(false);
    expect(isCodeProject({})).toBe(false);
    expect(isCodeProject(null)).toBe(false);
    expect(isCodeProject(undefined)).toBe(false);
  });
});

describe("codeProjectTaskIds", () => {
  it("hides code-project tasks but keeps general-project tasks visible", async () => {
    const { db } = fixture([
      project("code", "code"),
      project("reno", "general"),
      belongsTo("ship-feature", "code"),
      belongsTo("call-plumber", "reno"),
    ]);

    const hidden = await codeProjectTaskIds(db, "mine");

    expect([...hidden]).toEqual(["tasks:ship-feature"]);
  });

  // The whole point of the 2026-11-09 change: a personal project's obligations
  // must reach Home. Untyped legacy projects count as general.
  it("keeps tasks in projects with no kind set", async () => {
    const { db } = fixture([project("legacy"), belongsTo("book-movers", "legacy")]);

    expect(await codeProjectTaskIds(db, "mine")).toEqual(new Set());
  });

  it("does not hide a task whose project row is missing", async () => {
    const { db } = fixture([belongsTo("orphan", "deleted")]);

    expect(await codeProjectTaskIds(db, "mine")).toEqual(new Set());
  });

  it("ignores belongs_to rows that are not task -> project", async () => {
    const { db } = fixture([
      project("code", "code"),
      {
        _id: "relationships:note-to-project",
        brainInstanceId: "mine",
        type: "belongs_to",
        from: { entityType: "note", entityId: "knowledge:n" },
        to: { entityType: "project", entityId: "projects:code" },
      },
      {
        _id: "relationships:task-to-goal",
        brainInstanceId: "mine",
        type: "belongs_to",
        from: { entityType: "task", entityId: "tasks:t" },
        to: { entityType: "goal", entityId: "goals:g" },
      },
    ]);

    expect(await codeProjectTaskIds(db, "mine")).toEqual(new Set());
  });

  // Runs on every Home render, so repeated links to one project must not turn
  // into one db.get per task.
  it("resolves each project only once", async () => {
    const store = fixture([
      project("code", "code"),
      belongsTo("a", "code"),
      belongsTo("b", "code"),
      belongsTo("c", "code"),
    ]);

    const hidden = await codeProjectTaskIds(store.db, "mine");

    expect(hidden.size).toBe(3);
    expect(store.gets).toBe(1);
  });
});
