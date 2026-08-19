/**
 * Claude adapter: Claude Code via the Claude Agent SDK
 * (@anthropic-ai/claude-agent-sdk — the Claude Code harness as a library).
 *
 * Approval mapping (docs/mac-mini-agent-workbench.md → Harness adapter):
 * sessions run in `acceptEdits` scoped to the worktree, and `canUseTool`
 * intercepts everything outside the auto-allow policy, converting it into a
 * durable Skippy approval. `bypassPermissions` is never used.
 *
 * The SDK is imported dynamically and typed loosely on purpose: its message
 * type surface is still moving, and the adapter only relies on the stable
 * envelope fields (type / subtype / session_id / message.content).
 */
import path from "node:path";
import type {
  ApprovalRequest,
  HarnessAdapter,
  HarnessTurnRequest,
  HarnessTurnResult,
} from "./types.js";

/** Commands safe to run without approval inside the worktree. */
const AUTO_ALLOWED_COMMAND_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git add",
  "git commit",
  "ls",
  "cat",
  "grep",
  "rg",
  "find",
  "node",
  "npm test",
  "npm run",
  "pnpm test",
  "pnpm run",
  "pnpm typecheck",
  "pnpm build",
  "pnpm --filter",
  "pnpm -r",
  "corepack pnpm",
  "npx pnpm",
  "npx tsc",
  "npx vitest",
  // `cd` is harmless on its own; compound commands are classified per segment,
  // so a leading `cd <worktree>` no longer forces an approval round-trip.
  "cd ",
];

const DESTRUCTIVE_PATTERNS = [/\brm\s+-rf?\b/, /\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/, /\bsudo\b/];

export function classifyCommand(command: string): "allow" | "ask" {
  const trimmed = command.trim();
  if (DESTRUCTIVE_PATTERNS.some((re) => re.test(trimmed))) return "ask";
  // Split shell chaining (&&, ||, ;) and require EVERY segment to be
  // allowlisted. This both unblocks the common `cd <dir> && pnpm …` shape and
  // closes the old hole where `pnpm typecheck && <anything>` matched the
  // "pnpm typecheck" prefix and auto-allowed the whole line. Pipes and other
  // shell syntax we don't model fall through to "ask" (fail closed).
  const segments = trimmed
    .split(/&&|\|\||;/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return "ask";
  const allowed = segments.every((segment) =>
    AUTO_ALLOWED_COMMAND_PREFIXES.some((prefix) => segment.startsWith(prefix)),
  );
  return allowed ? "allow" : "ask";
}

function pathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, path.resolve(root, candidate));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n");
}

export class ClaudeAdapter implements HarnessAdapter {
  readonly harness = "claude" as const;

  async runTurn(request: HarnessTurnRequest): Promise<HarnessTurnResult> {
    // Dynamic import so type drift in the SDK never breaks the runner build.
    const sdk: any = await import("@anthropic-ai/claude-agent-sdk");
    const { prompt, worktreePath, onEvent, signal } = request;
    let approvalCounter = 0;
    let sessionId: string | undefined = request.externalThreadId;
    let resultText: string | undefined;
    // Kept for diagnosis: when the process dies (e.g. subscription usage
    // limit — "You've hit your limit"), the last assistant text usually says
    // why, while the SDK error is just "exited with code 1".
    let lastAssistantText: string | undefined;

    const canUseTool = async (toolName: string, input: any) => {
      const deny = (message: string) => ({ behavior: "deny", message });
      const allow = () => ({ behavior: "allow", updatedInput: input });
      const gate = async (approval: Omit<ApprovalRequest, "harnessRequestId">) => {
        approvalCounter += 1;
        const decision = await request.requestApproval({
          harnessRequestId: `claude-${sessionId ?? "new"}-${approvalCounter}`,
          ...approval,
        });
        if (decision === "accepted") return allow();
        if (decision === "cancelled") return deny("Run cancelled by the user.");
        return deny("The user declined this action. Adjust your approach or finish without it.");
      };

      if (toolName === "Bash") {
        const command = String(input?.command ?? "");
        if (classifyCommand(command) === "allow") return allow();
        return gate({
          kind: "command",
          title: `Run command: ${command.slice(0, 120)}`,
          details: { command: command.slice(0, 2000) },
        });
      }
      if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
        const filePath = String(input?.file_path ?? input?.path ?? "");
        if (filePath && pathInside(filePath, worktreePath)) return allow();
        return gate({
          kind: "file_change",
          title: `Edit outside worktree: ${filePath || "(unknown path)"}`,
          details: { filePath },
        });
      }
      if (toolName === "WebFetch" || toolName === "WebSearch") {
        return gate({
          kind: "network",
          title: `Network access via ${toolName}`,
          details: { input: JSON.stringify(input).slice(0, 500) },
        });
      }
      // Read-only and unknown tools: reads inside the repo are policy-allowed;
      // anything else unknown is asked.
      if (toolName === "Read" || toolName === "Glob" || toolName === "Grep" || toolName === "TodoWrite") {
        return allow();
      }
      // The user's own Skippy MCP tools are the point of the assistant —
      // capture/recall/task tools run without approval friction. Other MCP
      // servers still gate.
      if (toolName.startsWith("mcp__skippy")) {
        return allow();
      }
      return gate({ kind: "user_input", title: `Allow tool ${toolName}?`, details: { toolName } });
    };

    const options: Record<string, unknown> = {
      cwd: worktreePath,
      // bypassPermissions = --dangerously-skip-permissions: canUseTool is
      // never consulted, so no approvals surface. Chat-only, opt-in.
      permissionMode: request.bypassPermissions ? "bypassPermissions" : "acceptEdits",
      canUseTool,
      // The Agent SDK is isolated by default — it does NOT load the user's
      // Claude Code settings, which is where user-scope MCP servers (the
      // Skippy MCP) live. Loading them is the "same capabilities as a local
      // session" contract this runner exists to provide.
      settingSources: ["user", "project", "local"],
      abortController: undefined,
    };
    if (sessionId) options.resume = sessionId;

    try {
      const stream = sdk.query({ prompt, options });
      for await (const message of stream as AsyncIterable<any>) {
        if (signal.aborted) return { externalThreadId: sessionId, outcome: "interrupted" };
        switch (message?.type) {
          case "system":
            if (message.subtype === "init" && message.session_id) {
              sessionId = message.session_id;
              onEvent({ type: "status", payload: { phase: "session_started", sessionId } });
            }
            break;
          case "assistant": {
            const text = extractText(message.message?.content);
            if (text) {
              onEvent({ type: "assistant_message", payload: { text } });
              lastAssistantText = text;
            }
            const toolUses = Array.isArray(message.message?.content)
              ? message.message.content.filter((b: any) => b?.type === "tool_use")
              : [];
            for (const toolUse of toolUses) {
              if (toolUse.name === "Bash") {
                onEvent({
                  type: "command",
                  payload: { command: String(toolUse.input?.command ?? "").slice(0, 2000) },
                });
              } else if (toolUse.name === "Write" || toolUse.name === "Edit") {
                onEvent({
                  type: "file_change",
                  payload: { filePath: String(toolUse.input?.file_path ?? ""), tool: toolUse.name },
                });
              } else if (toolUse.name === "TodoWrite") {
                onEvent({ type: "plan_update", payload: { todos: toolUse.input?.todos ?? [] } });
              }
            }
            break;
          }
          case "result":
            if (message.session_id) sessionId = message.session_id;
            if (typeof message.result === "string") resultText = message.result;
            if (message.usage) onEvent({ type: "usage", payload: { usage: message.usage } });
            if (message.subtype && message.subtype !== "success") {
              return {
                externalThreadId: sessionId,
                outcome: "failed",
                errorMessage: `harness ended with ${message.subtype}`,
              };
            }
            break;
          default:
            break;
        }
      }
      return { externalThreadId: sessionId, outcome: "completed", resultText };
    } catch (error: unknown) {
      if (signal.aborted) return { externalThreadId: sessionId, outcome: "interrupted" };
      let messageText = error instanceof Error ? error.message : String(error);
      // A bare process exit is opaque; the session's last words usually carry
      // the real reason (usage limit, auth). Surface them together.
      if (/exited with code/i.test(messageText) && lastAssistantText) {
        messageText = `${messageText} — last message: "${lastAssistantText.slice(0, 200)}"`;
      }
      onEvent({ type: "error", payload: { message: messageText.slice(0, 500) } });
      return { externalThreadId: sessionId, outcome: "failed", errorMessage: messageText.slice(0, 500) };
    }
  }
}
