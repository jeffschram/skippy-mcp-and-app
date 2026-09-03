import { describe, expect, it, vi } from "vitest";
import {
  buildAgentPassPrompt,
  executeAgentPass,
  resolveAgentRoleToken,
} from "./agentPassExecutor.js";
import type { RunnerConfig } from "./config.js";
import type { ClaimedAgentPass, ControlPlane } from "./controlPlane.js";
import type { HarnessAdapter, HarnessTurnRequest, HarnessTurnResult } from "./harness/types.js";

const pass: ClaimedAgentPass = {
  configId: "cfg1",
  claimToken: "tok1",
  roleKey: "agenda",
  displayName: "Agenda Agent",
  skillSlugs: ["harness-bootstrap", "agenda-ingestion"],
  connectorSlugs: ["google"],
  harness: "claude",
  model: "sonnet",
};

const config = {
  allowedRoot: "/tmp/allowed",
  agentRoleTokens: { agenda: "skippy_agenda_token" },
  chatBypassPermissions: true,
} as unknown as RunnerConfig;

function fakePlane(lastRun: { completedAt: number; startedAt: number } | null = null) {
  return {
    completeAgentPass: vi.fn().mockResolvedValue({ status: "ok" }),
    lastCompletedIngestionRun: vi.fn().mockResolvedValue(lastRun),
  } as unknown as ControlPlane & {
    completeAgentPass: ReturnType<typeof vi.fn>;
    lastCompletedIngestionRun: ReturnType<typeof vi.fn>;
  };
}

function fakeAdapter(result: HarnessTurnResult) {
  const requests: HarnessTurnRequest[] = [];
  const adapter: HarnessAdapter = {
    harness: "claude",
    runTurn: async (request) => {
      requests.push(request);
      return result;
    },
  };
  return { adapter, requests };
}

describe("resolveAgentRoleToken", () => {
  it("returns the exact role entry", () => {
    expect(resolveAgentRoleToken({ agenda: "a" }, "agenda")).toBe("a");
  });

  it("resolves pm:{projectId} roles to the shared pm entry", () => {
    expect(resolveAgentRoleToken({ pm: "p" }, "pm:abc123")).toBe("p");
  });

  it("returns undefined (full-token fallback) when the role has no entry", () => {
    expect(resolveAgentRoleToken({ agenda: "a" }, "finance")).toBeUndefined();
  });
});

describe("buildAgentPassPrompt", () => {
  it("names the role, the skills to load, and the unattended constraints", () => {
    const prompt = buildAgentPassPrompt(pass);
    expect(prompt).toContain("Agenda Agent");
    expect(prompt).toContain("role agenda");
    expect(prompt).toContain("get_skill");
    expect(prompt).toContain("harness-bootstrap, agenda-ingestion");
    expect(prompt).toContain("never mark tasks done");
  });

  it("appends the project id for pm roles", () => {
    const prompt = buildAgentPassPrompt({ ...pass, roleKey: "pm:proj42" });
    expect(prompt).toContain("manages project proj42");
  });

  it("pins the host's connectors as the sources in scope", () => {
    // 2026-08-30: the agenda pass silently skipped imessage when scope was
    // left implicit — the prompt must enumerate the host's connectors.
    const prompt = buildAgentPassPrompt({ ...pass, connectorSlugs: ["google", "imessage"] });
    expect(prompt).toContain("sources in scope: google, imessage");
  });

  it("omits the connector line when the host provides none", () => {
    const prompt = buildAgentPassPrompt({ ...pass, connectorSlugs: [] });
    expect(prompt).not.toContain("sources in scope");
  });

  it("pins the ingestion cursor block after the connector scope line", () => {
    // 2026-09-03: the read window must be pinned by the host like the scope
    // line — improvised windows re-read the same sources every hour.
    const prompt = buildAgentPassPrompt(pass, "Only read source content newer than X.");
    const lines = prompt.split("\n");
    const scopeIndex = lines.findIndex((line) => line.includes("sources in scope"));
    expect(lines[scopeIndex + 1]).toBe("Only read source content newer than X.");
  });

  it("drops the cursor block when there are no connectors to read", () => {
    const prompt = buildAgentPassPrompt(
      { ...pass, connectorSlugs: [] },
      "Only read source content newer than X.",
    );
    expect(prompt).not.toContain("newer than X");
  });
});

describe("executeAgentPass", () => {
  it("runs the turn with the agent's model and scoped token, then completes", async () => {
    const plane = fakePlane();
    const { adapter, requests } = fakeAdapter({ outcome: "completed", resultText: "triage done" });
    await executeAgentPass(config, plane, pass, adapter);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe("sonnet");
    expect(requests[0]?.mcpToken).toBe("skippy_agenda_token");
    expect(requests[0]?.worktreePath).toBe("/tmp/allowed");
    expect(plane.completeAgentPass).toHaveBeenCalledWith("cfg1", "tok1", {
      status: "completed",
      summary: "triage done",
    });
  });

  it("reports a failed pass with the harness error", async () => {
    const plane = fakePlane();
    const { adapter } = fakeAdapter({ outcome: "failed", errorMessage: "boom" });
    await executeAgentPass(config, plane, pass, adapter);
    expect(plane.completeAgentPass).toHaveBeenCalledWith("cfg1", "tok1", {
      status: "failed",
      summary: "boom",
    });
  });

  it("reports failure when the adapter throws, never leaving the claim dangling", async () => {
    const plane = fakePlane();
    const adapter: HarnessAdapter = {
      harness: "claude",
      runTurn: async () => {
        throw new Error("spawn ENOENT");
      },
    };
    await executeAgentPass(config, plane, pass, adapter);
    expect(plane.completeAgentPass).toHaveBeenCalledWith("cfg1", "tok1", {
      status: "failed",
      summary: "spawn ENOENT",
    });
  });

  it("falls back to the adapter's full token when no scoped token exists", async () => {
    const plane = fakePlane();
    const { adapter, requests } = fakeAdapter({ outcome: "completed" });
    await executeAgentPass(config, plane, { ...pass, roleKey: "finance" }, adapter);
    // undefined mcpToken = adapter uses its configured full-access token,
    // mirroring skippyMcpTaskToken's compatibility behavior.
    expect(requests[0]?.mcpToken).toBeUndefined();
    expect(plane.completeAgentPass).toHaveBeenCalledWith("cfg1", "tok1", { status: "completed" });
  });

  it("declines approvals — nobody is watching an unattended pass", async () => {
    const plane = fakePlane();
    let decision: string | undefined;
    const adapter: HarnessAdapter = {
      harness: "claude",
      runTurn: async (request) => {
        decision = await request.requestApproval({
          harnessRequestId: "r1",
          kind: "command",
          title: "rm -rf /",
        });
        return { outcome: "completed" };
      },
    };
    await executeAgentPass(config, plane, pass, adapter);
    expect(decision).toBe("declined");
  });

  it("injects the completed-run cursor into the prompt for connector passes", async () => {
    const completedAt = Date.now() - 60 * 60_000;
    const plane = fakePlane({ completedAt, startedAt: completedAt - 5 * 60_000 });
    const { adapter, requests } = fakeAdapter({ outcome: "completed" });
    await executeAgentPass(config, plane, pass, adapter);
    expect(plane.lastCompletedIngestionRun).toHaveBeenCalledWith("agenda");
    expect(requests[0]?.prompt).toContain(
      `Last successful pass completed ${new Date(completedAt).toISOString()}`,
    );
    expect(requests[0]?.prompt).toContain("Do not improvise a wider window.");
  });

  it("falls back to the 48h window when the cursor fetch throws", async () => {
    // The cursor is an optimization; a Convex hiccup must not fail the pass.
    const plane = fakePlane();
    plane.lastCompletedIngestionRun.mockRejectedValue(new Error("network down"));
    const { adapter, requests } = fakeAdapter({ outcome: "completed" });
    await executeAgentPass(config, plane, pass, adapter);
    expect(requests[0]?.prompt).toContain("read the last 48 hours only");
    expect(plane.completeAgentPass).toHaveBeenCalledWith("cfg1", "tok1", { status: "completed" });
  });

  it("skips the cursor fetch entirely for passes without connectors", async () => {
    const plane = fakePlane();
    const { adapter, requests } = fakeAdapter({ outcome: "completed" });
    await executeAgentPass(config, plane, { ...pass, connectorSlugs: [] }, adapter);
    expect(plane.lastCompletedIngestionRun).not.toHaveBeenCalled();
    expect(requests[0]?.prompt).not.toContain("48 hours");
  });
});
