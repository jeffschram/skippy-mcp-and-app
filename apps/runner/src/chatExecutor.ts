/**
 * Executes one claimed conversational chat turn on a local harness.
 *
 * Unlike RunExecutor there is no worktree, verification, or publish: the
 * harness runs in the project checkout (project chats mapped to this host) or
 * the runner's allowed root (page chats), with the same local capabilities as
 * a terminal session. Gated actions surface as approval cards in the chat
 * panel via the chat-turn approval flow.
 */
import fs from "node:fs";
import type { RunnerConfig } from "./config.js";
import type { ClaimedChatTurn, ControlPlane } from "./controlPlane.js";
import type { HarnessAdapter } from "./harness/types.js";
import { assertInsideAllowedRoot } from "./worktree.js";

export async function executeChatTurn(
  config: RunnerConfig,
  plane: ControlPlane,
  turn: ClaimedChatTurn,
  adapter: HarnessAdapter,
): Promise<void> {
  const abort = new AbortController();
  const cancelWatcher = setInterval(() => {
    void plane
      .chatTurnControlState(turn.turnId)
      .then((state) => {
        if (state.cancelRequested) abort.abort();
      })
      .catch(() => {});
  }, 3_000);

  try {
    await plane.markChatTurnRunning(turn.turnId, turn.claimToken);

    // Working directory: mapped project checkout, else the allowed root.
    let cwd = config.allowedRoot;
    if (turn.cwd) {
      try {
        const resolved = assertInsideAllowedRoot(turn.cwd, config.allowedRoot);
        if (fs.existsSync(resolved)) cwd = resolved;
      } catch {
        // Fall back to the allowed root rather than failing the turn.
      }
    }

    const prompt = buildChatPrompt(turn);
    const result = await adapter.runTurn({
      prompt,
      worktreePath: cwd,
      signal: abort.signal,
      // Chat turns keep no durable event stream (v1) — the reply is the product.
      onEvent: () => {},
      requestApproval: async (approval) => {
        await plane.requestChatApproval(turn.turnId, turn.claimToken, approval);
        return plane.awaitChatApproval(turn.turnId, approval.harnessRequestId, { signal: abort.signal });
      },
      ...(turn.externalThreadId ? { externalThreadId: turn.externalThreadId } : {}),
    });

    if (result.outcome === "completed") {
      await plane.completeChatTurn(turn.turnId, turn.claimToken, {
        resultText: result.resultText ?? "",
        ...(result.externalThreadId ? { externalThreadId: result.externalThreadId } : {}),
      });
    } else {
      await plane.completeChatTurn(turn.turnId, turn.claimToken, {
        errorMessage:
          result.outcome === "interrupted"
            ? "Chat turn was cancelled."
            : (result.errorMessage ?? "harness failed"),
        ...(result.externalThreadId ? { externalThreadId: result.externalThreadId } : {}),
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[skippy-runner] chat turn ${turn.turnId} failed:`, error);
    await plane
      .completeChatTurn(turn.turnId, turn.claimToken, { errorMessage: message.slice(0, 500) })
      .catch(() => {});
  } finally {
    clearInterval(cancelWatcher);
  }
}

function buildChatPrompt(turn: ClaimedChatTurn): string {
  // Resumed harness threads already hold the conversation — send only the new
  // user message. Fresh threads get the scope preamble plus recent history.
  if (turn.externalThreadId) return turn.userContent;

  const lines = [
    "You are the user's Skippy assistant, chatting from the Skippy web app. You have your normal local capabilities (files, commands, tools); use them when they help answer.",
    turn.scopeContext,
    "",
  ];
  if (turn.history.length) {
    lines.push("Conversation so far:");
    for (const message of turn.history) {
      lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${message.content}`);
    }
    lines.push("");
  }
  lines.push(`User: ${turn.userContent}`);
  return lines.filter((line) => line !== undefined).join("\n");
}
