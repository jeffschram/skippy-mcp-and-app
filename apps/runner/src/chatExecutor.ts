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
import type { HarnessAdapter, HarnessEvent } from "./harness/types.js";
import { assertInsideAllowedRoot } from "./worktree.js";

/** How often buffered live-activity events are flushed to the control plane. */
const CHAT_EVENT_FLUSH_INTERVAL_MS = 1_000;
/** Event types worth showing in the chat panel while the turn runs. */
const LIVE_EVENT_TYPES = new Set(["assistant_message", "command", "file_change", "plan_update", "status", "error"]);

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

  // Live activity feed: buffer harness events and flush them on an interval so
  // the chat panel can show what the harness is doing instead of bare
  // "Thinking". Best-effort — a lost batch degrades the live view, never the
  // turn (events are re-queued once; the reply remains the durable product).
  let seq = 0;
  let pending: Array<{ seq: number; type: string; payload?: unknown }> = [];
  const emit = (event: HarnessEvent) => {
    if (!LIVE_EVENT_TYPES.has(event.type)) return;
    seq += 1;
    pending.push({ seq, type: event.type, payload: event.payload });
  };
  const flushEvents = async () => {
    const batch = pending.splice(0, pending.length);
    if (!batch.length) return;
    try {
      await plane.reportChatTurnEvents(turn.turnId, turn.claimToken, batch);
    } catch {
      // Transient failure: put the batch back (bounded) and retry next tick.
      pending = [...batch, ...pending].slice(-200);
    }
  };
  const eventFlusher = setInterval(() => void flushEvents(), CHAT_EVENT_FLUSH_INTERVAL_MS);

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
      bypassPermissions: config.chatBypassPermissions,
      signal: abort.signal,
      // Live activity: forwarded to the control plane for the chat panel's
      // in-flight view; rows are deleted when the turn completes (the reply
      // is the durable product).
      onEvent: emit,
      requestApproval: async (approval) => {
        await plane.requestChatApproval(turn.turnId, turn.claimToken, approval);
        // Deliberately no approval timeout here (unlike code runs): a chat
        // approval card sits in front of an interactive user who can decide
        // or cancel the turn; auto-expiring it would only add noise.
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
    clearInterval(eventFlusher);
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
