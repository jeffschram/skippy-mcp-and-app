/**
 * Executes one claimed scheduled agent pass (docs/connectors.md → Executing
 * an agent pass).
 *
 * Unlike RunExecutor there is no worktree, verification, or publish; unlike
 * ChatExecutor there is no interactive user. The harness runs one turn in the
 * allowed root with a one-line prompt: load the config's skills via get_skill
 * and follow them. Everything behavioral stays in the versioned skills — the
 * runner contributes scheduling, credential plumbing, and supervision.
 */
import type { RunnerConfig } from "./config.js";
import type { ClaimedAgentPass, ControlPlane } from "./controlPlane.js";
import type { HarnessAdapter } from "./harness/types.js";

/**
 * Hard ceiling per pass. Agenda runs hourly; a pass still going after this is
 * pathological (runaway loop or stuck approval) and must not stack into the
 * next slot. The stranded-run pattern (T4/T5, 2026-08-28) showed sessions can
 * die silently — here the runner itself reports the failure.
 */
export const AGENT_PASS_TIMEOUT_MS = 15 * 60_000;

/**
 * Role → plaintext token. pm:{projectId} configs share the "pm" entry (one
 * token per ROLE, not per project — the allowlist is role-shaped). Undefined
 * means "no scoped token on this host": callers fall back to the adapter's
 * full token, mirroring skippyMcpTaskToken's compatibility behavior.
 */
export function resolveAgentRoleToken(
  tokens: Record<string, string>,
  roleKey: string,
): string | undefined {
  return tokens[roleKey] ?? (roleKey.startsWith("pm:") ? tokens["pm"] : undefined);
}

/** One-line bootstrap per docs/connectors.md: name the role and skills; the
 * pass fetches the skill bodies itself so behavior stays versioned in Convex. */
export function buildAgentPassPrompt(
  pass: Pick<ClaimedAgentPass, "roleKey" | "displayName" | "skillSlugs">,
): string {
  const lines = [
    `You are "${pass.displayName}" (role ${pass.roleKey}), running one scheduled, unattended Skippy agent pass.`,
    `Load your operating instructions with the Skippy MCP get_skill tool — slugs: ${pass.skillSlugs.join(", ")} — then follow them for exactly one pass.`,
  ];
  if (pass.roleKey.startsWith("pm:")) {
    lines.push(`This pass manages project ${pass.roleKey.slice("pm:".length)}.`);
  }
  lines.push(
    "Nobody is watching this session: never wait for user input, never mark tasks done, and finish quietly when there is nothing to do.",
  );
  return lines.join("\n");
}

export async function executeAgentPass(
  config: RunnerConfig,
  plane: ControlPlane,
  pass: ClaimedAgentPass,
  adapter: HarnessAdapter,
): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), AGENT_PASS_TIMEOUT_MS);
  try {
    const scopedToken = resolveAgentRoleToken(config.agentRoleTokens, pass.roleKey);
    if (!scopedToken) {
      // Compatibility fallback, same as task runs before SKIPPY_MCP_TASK_TOKEN:
      // the pass still runs, on the full-access token, and we say so.
      console.log(
        `[skippy-runner] agent pass ${pass.roleKey}: no scoped token configured — using full MCP token`,
      );
    }
    const result = await adapter.runTurn({
      prompt: buildAgentPassPrompt(pass),
      worktreePath: config.allowedRoot,
      // Budget knobs (docs/token-efficiency.md §4): the agent's configured
      // model and role-scoped token; absent model = harness default.
      model: pass.model,
      mcpToken: scopedToken,
      // The host's existing chat opt-in governs unattended passes too; without
      // it, actions outside the harness auto-allow are declined below and the
      // pass degrades to MCP-only work rather than stranding on a card.
      bypassPermissions: config.chatBypassPermissions,
      signal: abort.signal,
      onEvent: () => {},
      requestApproval: async (request) => {
        console.log(
          `[skippy-runner] agent pass ${pass.roleKey}: declined unattended approval '${request.title}'`,
        );
        return "declined";
      },
    });
    if (result.outcome === "completed") {
      await plane.completeAgentPass(pass.configId, pass.claimToken, {
        status: "completed",
        ...(result.resultText ? { summary: result.resultText.slice(0, 300) } : {}),
      });
    } else {
      await plane.completeAgentPass(pass.configId, pass.claimToken, {
        status: "failed",
        summary: abort.signal.aborted
          ? `pass timed out after ${AGENT_PASS_TIMEOUT_MS / 60_000} minutes`
          : (result.errorMessage ?? `harness ${result.outcome}`).slice(0, 300),
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await plane
      .completeAgentPass(pass.configId, pass.claimToken, {
        status: "failed",
        summary: message.slice(0, 300),
      })
      .catch(() => {});
  } finally {
    clearTimeout(timeout);
  }
}
