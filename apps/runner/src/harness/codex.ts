/**
 * Codex adapter: `codex exec --json` (non-interactive Codex CLI).
 *
 * Event model (verified against codex-cli 0.147.0): JSONL on stdout —
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.started"|"item.updated"|"item.completed","item":{...}}
 *   {"type":"turn.completed","usage":{...}}
 * Item types include agent_message, reasoning, command_execution, file_change,
 * todo_list. Unknown types are passed through defensively as status events.
 *
 * Approval mapping differs from the Claude adapter by design: exec mode has no
 * interactive approval callback, so the boundary is enforced by the Codex
 * sandbox instead — `workspace-write` scoped to the worktree, network off by
 * default. Out-of-policy actions fail inside the sandbox rather than
 * escalating to the user. The publish gate stays in the runner (harness-
 * agnostic), so pushes/PRs still require explicit approval in the web app.
 * Interactive escalation via the Codex App Server protocol is a later
 * refinement.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { HarnessAdapter, HarnessEvent, HarnessTurnRequest, HarnessTurnResult } from "./types.js";

function truncate(text: unknown, max: number): string {
  return String(text ?? "").slice(0, max);
}

export function buildCodexArgs({
  worktreePath,
  threadId,
  bypassPermissions,
}: {
  worktreePath: string;
  threadId?: string | undefined;
  bypassPermissions?: boolean | undefined;
}): string[] {
  const args = ["exec", "--json", "--cd", worktreePath, "--skip-git-repo-check", "--color", "never"];

  if (bypassPermissions) {
    // Codex's equivalent of --dangerously-skip-permissions. Chat-only, opt-in.
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", "workspace-write");
  }

  if (threadId) {
    args.push("resume", threadId);
  }

  // The prompt goes over stdin ("-") to avoid argv length/quoting issues.
  args.push("-");
  return args;
}

/** Translate one codex JSONL item into zero or one HarnessEvent. */
function eventForItem(phase: "started" | "updated" | "completed", item: any): HarnessEvent | null {
  switch (item?.type) {
    case "agent_message":
      return phase === "completed" ? { type: "assistant_message", payload: { text: truncate(item.text, 8000) } } : null;
    case "command_execution":
      if (phase === "started") {
        return { type: "command", payload: { command: truncate(item.command, 2000) } };
      }
      if (phase === "completed") {
        return {
          type: "command_result",
          payload: {
            command: truncate(item.command, 2000),
            exitCode: item.exit_code ?? null,
            outputTail: truncate(item.aggregated_output, 1500),
          },
        };
      }
      return null;
    case "file_change":
      return phase === "completed"
        ? {
            type: "file_change",
            payload: {
              status: item.status,
              files: Array.isArray(item.changes)
                ? item.changes.map((c: any) => truncate(c.path, 300)).slice(0, 50)
                : undefined,
            },
          }
        : null;
    case "todo_list":
      return {
        type: "plan_update",
        payload: {
          todos: Array.isArray(item.items)
            ? item.items.map((t: any) => ({ content: truncate(t.text ?? t.content, 300), status: t.completed ? "completed" : "pending" }))
            : [],
        },
      };
    case "reasoning":
      return null; // summaries only; not part of the durable transcript
    case "error":
      return { type: "error", payload: { message: truncate(item.message, 500) } };
    default:
      return phase === "completed" ? { type: "status", payload: { phase: `codex_item_${item?.type ?? "unknown"}` } } : null;
  }
}

export class CodexAdapter implements HarnessAdapter {
  readonly harness = "codex" as const;

  async runTurn(request: HarnessTurnRequest): Promise<HarnessTurnResult> {
    const { prompt, worktreePath, onEvent, signal } = request;
    let threadId: string | undefined = request.externalThreadId;
    let resultText: string | undefined;
    let turnFailed: string | undefined;

    // Exec-level options must precede the optional `resume` subcommand.
    const args = buildCodexArgs({
      worktreePath,
      threadId,
      bypassPermissions: request.bypassPermissions,
    });

    return new Promise<HarnessTurnResult>((resolve) => {
      const child = spawn("codex", args, {
        cwd: worktreePath,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      let settled = false;
      const settle = (result: HarnessTurnResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      const onAbort = () => {
        child.kill("SIGTERM");
        settle({ externalThreadId: threadId, outcome: "interrupted" });
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      child.stdin.write(prompt);
      child.stdin.end();

      let stderrTail = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-1000);
      });

      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          return; // non-JSONL noise
        }
        switch (message?.type) {
          case "thread.started":
            if (message.thread_id) {
              threadId = message.thread_id;
              onEvent({ type: "status", payload: { phase: "session_started", sessionId: threadId } });
            }
            break;
          case "item.started":
          case "item.updated":
          case "item.completed": {
            const phase = message.type.split(".")[1] as "started" | "updated" | "completed";
            if (message.item?.type === "agent_message" && phase === "completed") {
              resultText = truncate(message.item.text, 8000);
            }
            const event = eventForItem(phase, message.item);
            if (event) onEvent(event);
            break;
          }
          case "turn.completed":
            if (message.usage) onEvent({ type: "usage", payload: { usage: message.usage } });
            break;
          case "turn.failed":
            turnFailed = truncate(message.error?.message ?? "codex turn failed", 500);
            onEvent({ type: "error", payload: { message: turnFailed } });
            break;
          case "error":
            turnFailed = truncate(message.message ?? "codex error", 500);
            onEvent({ type: "error", payload: { message: turnFailed } });
            break;
          default:
            break;
        }
      });

      child.on("error", (error) => {
        settle({
          externalThreadId: threadId,
          outcome: "failed",
          errorMessage: `failed to launch codex CLI: ${truncate(error.message, 300)}`,
        });
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          settle({ externalThreadId: threadId, outcome: "interrupted" });
          return;
        }
        if (turnFailed || code !== 0) {
          settle({
            externalThreadId: threadId,
            outcome: "failed",
            errorMessage: turnFailed ?? `codex exited with code ${code}: ${truncate(stderrTail, 300)}`,
          });
          return;
        }
        settle({ externalThreadId: threadId, outcome: "completed", resultText });
      });
    });
  }
}
