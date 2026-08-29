import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prTitle, RunExecutor } from "./runExecutor.js";
import type { ClaimedRun, ControlPlane } from "./controlPlane.js";
import type { HarnessAdapter, HarnessTurnRequest, HarnessTurnResult } from "./harness/types.js";
import type { RunnerConfig } from "./config.js";

// The stall-watchdog tests drive RunExecutor.execute() end to end under fake
// timers, so everything that would touch git/fs/network is mocked out.
vi.mock("./worktree.js", () => ({
  assertGitRepo: vi.fn(async () => {}),
  assertInsideAllowedRoot: vi.fn((p: string) => p),
  commitAll: vi.fn(async () => {}),
  createOrUpdatePr: vi.fn(async () => "https://example.com/pr/1"),
  diffSummary: vi.fn(async () => ""),
  ensureWorktree: vi.fn(async () => ({ worktreePath: "/wt/run", branchName: "agent/test-branch" })),
  hasUncommittedChanges: vi.fn(async () => false),
  provisionWorktree: vi.fn(async () => ({ status: "ok", message: "", durationMs: 0 })),
  pushBranch: vi.fn(async () => {}),
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
}));
vi.mock("./fileWorkspace.js", () => ({
  collectArtifacts: vi.fn(async () => []),
  materializeManifest: vi.fn(async () => ({ inputRoot: undefined, files: [] })),
}));
// Real fs would resolve outside the fake-timer loop (and try to mkdir /wt).
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}x`),
    rm: vi.fn(async () => {}),
  },
}));

describe("prTitle", () => {
  it("titles the PR after the task, not the project", () => {
    expect(
      prTitle({ taskTitle: "Collapse completed phases", project: { title: "Skippy MCP and APP" } }, "agent/task-abc"),
    ).toBe("Agent: Collapse completed phases");
  });

  it("falls back to the project title for chat-scoped runs without a task", () => {
    expect(prTitle({ project: { title: "Skippy MCP and APP" } }, "agent/chat-abc")).toBe(
      "Agent: Skippy MCP and APP",
    );
  });

  it("falls back to the branch name when neither title exists", () => {
    expect(prTitle({ project: {} }, "agent/chat-abc")).toBe("Agent work on agent/chat-abc");
  });

  it("ignores whitespace-only task titles", () => {
    expect(prTitle({ taskTitle: "   ", project: { title: "Skippy MCP and APP" } }, "agent/task-abc")).toBe(
      "Agent: Skippy MCP and APP",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Stall watchdog (T4/T5/Google-connector strandings, 2026-08-27..29) */
/* ------------------------------------------------------------------ */

const STALL_MS = 15 * 60_000;
const GRACE_MS = 2 * 60_000;

function makePlane() {
  const statusCalls: Array<{ status: string; extra?: Record<string, unknown> }> = [];
  const plane = {
    updateRunStatus: vi.fn(async (_runId: string, _token: string, status: string, extra?: Record<string, unknown>) => {
      statusCalls.push({ status, extra });
    }),
    reportEvents: vi.fn(async () => {}),
    controlState: vi.fn(async () => ({ cancelRequested: false })),
    requestApproval: vi.fn(async () => {}),
    awaitApproval: vi.fn(async () => "accepted" as const),
    cancelApproval: vi.fn(async () => {}),
  };
  return { plane: plane as unknown as ControlPlane, raw: plane, statusCalls };
}

const config = {
  allowedRoot: "/",
  worktreeRoot: "/wt",
  approvalTimeoutMs: 24 * 60 * 60 * 1000,
  skippyMcpTaskToken: "task-token",
} as unknown as RunnerConfig;

const run = {
  runId: "run1",
  claimToken: "claim1",
  harness: "claude",
  attempt: 1,
  chatId: "chat00001",
  baseBranch: "main",
  executionBrief: "Do the thing",
  workspaceMode: "code",
  project: { _id: "p1", title: "Proj", localPath: "/repo" },
  outputPolicy: { enabled: false, required: false, maxFiles: 1, maxFileBytes: 1, maxTotalBytes: 1 },
} as unknown as ClaimedRun;

function adapterOf(runTurn: (request: HarnessTurnRequest) => Promise<HarnessTurnResult>): HarnessAdapter {
  return { harness: "claude", runTurn: vi.fn(runTurn) } as unknown as HarnessAdapter;
}

describe("stall watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("force-fails a run whose harness hangs and ignores abort", async () => {
    const { plane, statusCalls } = makePlane();
    // Never settles, never emits, ignores the abort signal entirely.
    const adapter = adapterOf(() => new Promise<never>(() => {}));
    const done = new RunExecutor(config, plane, run, adapter).execute();

    await vi.advanceTimersByTimeAsync(STALL_MS + GRACE_MS + 60_000);
    await done;

    const last = statusCalls.at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.extra?.errorCategory).toBe("stalled");
    expect(String(last?.extra?.errorMessage)).toContain("harness_turn");
    expect(String(last?.extra?.errorMessage)).toContain("/wt/run");
  });

  it("reports 'stalled' (not 'cancelled') when the aborted harness shuts down cleanly", async () => {
    const { plane, statusCalls } = makePlane();
    const adapter = adapterOf(
      (request) =>
        new Promise<HarnessTurnResult>((resolve) => {
          request.signal.addEventListener("abort", () => resolve({ outcome: "interrupted" }));
        }),
    );
    const done = new RunExecutor(config, plane, run, adapter).execute();

    await vi.advanceTimersByTimeAsync(STALL_MS + 60_000);
    await done;

    const last = statusCalls.at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.extra?.errorCategory).toBe("stalled");
    expect(statusCalls.some((c) => c.status === "cancelled")).toBe(false);
  });

  it("does not stall a long turn that keeps emitting events", async () => {
    const { plane, statusCalls } = makePlane();
    const adapter = adapterOf(
      (request) =>
        new Promise<HarnessTurnResult>((resolve) => {
          // 40-minute turn with a heartbeat event every 5 minutes.
          const beat = setInterval(() => request.onEvent({ type: "status", payload: {} }), 5 * 60_000);
          setTimeout(() => {
            clearInterval(beat);
            resolve({ outcome: "completed", resultText: "long but alive" });
          }, 40 * 60_000);
        }),
    );
    const done = new RunExecutor(config, plane, run, adapter).execute();

    await vi.advanceTimersByTimeAsync(45 * 60_000);
    await done;

    expect(statusCalls.some((c) => c.status === "failed")).toBe(false);
    expect(statusCalls.at(-1)?.status).toBe("in_review");
  });

  it("exempts human-paced approval waits from stall detection", async () => {
    const { plane, raw, statusCalls } = makePlane();
    const { diffSummary } = await import("./worktree.js");
    vi.mocked(diffSummary).mockResolvedValueOnce("1 file changed");
    // Publish approval sits pending for 30 minutes before being declined.
    raw.awaitApproval = vi.fn(
      () => new Promise<"declined">((resolve) => setTimeout(() => resolve("declined"), 30 * 60_000)),
    ) as never;
    const adapter = adapterOf(async () => ({ outcome: "completed", resultText: "done" }));
    const done = new RunExecutor(config, plane, run, adapter).execute();

    await vi.advanceTimersByTimeAsync(35 * 60_000);
    await done;

    expect(statusCalls.some((c) => c.status === "failed")).toBe(false);
    const last = statusCalls.at(-1);
    expect(last?.status).toBe("in_review");
    expect(String(last?.extra?.resultSummary)).toContain("declined");
  });
});
