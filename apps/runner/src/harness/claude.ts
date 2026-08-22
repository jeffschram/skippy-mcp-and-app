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
import { isHarnessTeardownError } from "./teardownErrors.js";
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
  // Read-only git archaeology (each of these stalled a real run 20+ min in
  // the week of 2026-08-18 waiting on an approval nobody was around to click).
  "git grep",
  "git show",
  "git add",
  "git commit",
  "ls",
  "cat",
  "grep",
  "rg",
  "find",
  // Read-only text tooling (2026-08-21 six-gate autopsy: `sed -n`, `which`,
  // and pipe tails each fired a gate). `sed` can write files in-place, but
  // only inside the worktree the session already edits freely under
  // acceptEdits — the same trust boundary as the Edit tool.
  "sed",
  "which",
  "head",
  "tail",
  "wc",
  "node",
  "npm test",
  "npm run",
  "npm ls",
  "pnpm test",
  "pnpm run",
  "pnpm typecheck",
  "pnpm build",
  "pnpm --filter",
  "pnpm -r",
  "corepack pnpm",
  // Worktree provisioning tooling (used by the runner itself; sessions may
  // echo it when node_modules is missing).
  "corepack enable",
  "corepack prepare",
  "npx pnpm",
  "npx tsc",
  "npx vitest",
  // Direct invocations of workspace-local test/typecheck binaries.
  "./node_modules/.bin/vitest",
  "./node_modules/.bin/tsc",
  "node_modules/.bin/vitest",
  "node_modules/.bin/tsc",
  // `cd` is harmless on its own; compound commands are classified per segment,
  // so a leading `cd <worktree>` no longer forces an approval round-trip.
  "cd ",
];

const DESTRUCTIVE_PATTERNS = [/\brm\s+-rf?\b/, /\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/, /\bsudo\b/];

/** One shell env assignment token, e.g. `PATH=/x:$PATH` or `FOO="a b"`. */
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*/;

/**
 * Strip leading `VAR=value` assignments from a command segment so
 * `PATH=… pnpm test` prefix-matches like `pnpm test` — mirroring how PR #110
 * made a leading `cd <dir>` stop forcing approval round-trips. Runs AFTER the
 * destructive-pattern check, which sees the full original line, so stripping
 * can never hide a destructive command.
 */
function stripEnvAssignments(segment: string): string {
  let rest = segment;
  for (;;) {
    const next = rest.replace(ENV_ASSIGNMENT_RE, "");
    if (next === rest) break;
    rest = next;
  }
  return rest.trim();
}

/**
 * Normalize `npx` flag prefixes so `npx --yes pnpm@8.10.2 typecheck`
 * prefix-matches the existing `npx pnpm` intent (2026-08-21 autopsy gates
 * 4–5: improvised versioned invocations in an unprovisioned worktree).
 * Only the inert confirmation flags `--yes`/`-y` are stripped; anything else
 * after `npx` still has to match a prefix on its own.
 */
function normalizeNpx(segment: string): string {
  if (!/^npx\s/.test(segment)) return segment;
  let rest = segment.replace(/^npx\s+/, "");
  for (;;) {
    const next = rest.replace(/^(?:--yes|-y)\s+/, "");
    if (next === rest) break;
    rest = next;
  }
  return `npx ${rest}`;
}

/**
 * `git restore` is allowed only when scoped: every non-flag argument must be
 * a path that resolves inside the worktree. Fails closed when no worktree
 * root is known or no path argument is given.
 */
function gitRestoreAllowed(segment: string, worktreePath: string | undefined): boolean {
  if (!worktreePath) return false;
  const tokens = segment.split(/\s+/).slice(2); // drop "git restore"
  const pathArgs = tokens
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter((token) => token.length > 0 && !token.startsWith("-"));
  if (pathArgs.length === 0) return false;
  return pathArgs.every((candidate) => pathInside(candidate, worktreePath));
}

/**
 * `git checkout` is allowed ONLY in its scoped path-restore form
 * (`git checkout -- <paths>`), mirroring gitRestoreAllowed: every path after
 * `--` must resolve inside the worktree. Branch switching, `-b`, and every
 * other checkout form still ask. Fails closed without a worktree root or
 * without paths (2026-08-21 autopsy gate 6).
 */
function gitCheckoutAllowed(segment: string, worktreePath: string | undefined): boolean {
  if (!worktreePath) return false;
  const tokens = segment.split(/\s+/).slice(2); // drop "git checkout"
  if (tokens[0] !== "--") return false;
  const pathArgs = tokens
    .slice(1)
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter((token) => token.length > 0);
  if (pathArgs.length === 0) return false;
  return pathArgs.every((candidate) => pathInside(candidate, worktreePath));
}

function segmentAllowed(rawSegment: string, worktreePath: string | undefined): boolean {
  // A segment that only exports env assignments (`export PATH=… && pnpm …`)
  // is inert on its own, like `cd`.
  if (/^export\s/.test(rawSegment)) {
    return stripEnvAssignments(rawSegment.replace(/^export\s+/, "")) === "";
  }
  const segment = normalizeNpx(stripEnvAssignments(rawSegment));
  if (!segment) return false;
  if (segment.startsWith("git restore")) return gitRestoreAllowed(segment, worktreePath);
  if (segment.startsWith("git checkout")) return gitCheckoutAllowed(segment, worktreePath);
  return AUTO_ALLOWED_COMMAND_PREFIXES.some((prefix) => segment.startsWith(prefix));
}

export function classifyCommand(command: string, worktreePath?: string): "allow" | "ask" {
  const trimmed = command.trim();
  if (DESTRUCTIVE_PATTERNS.some((re) => re.test(trimmed))) return "ask";
  // Split shell chaining (&&, ||, ;) AND single-pipe composition (|), and
  // require EVERY segment to be allowlisted. This both unblocks the common
  // `cd <dir> && pnpm …` and `cat x | head -30` shapes and closes the old
  // hole where `pnpm typecheck && <anything>` matched the "pnpm typecheck"
  // prefix and auto-allowed the whole line. Alternation order matters: `||`
  // must match before `|` so it splits as one separator, not two. Piping
  // into a non-allowlisted consumer (`cat x | sh`) still asks, and
  // DESTRUCTIVE_PATTERNS ran against the full original line above, so no
  // split can hide a destructive stage. Other shell syntax we don't model
  // falls through to "ask" (fail closed).
  const segments = trimmed
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return "ask";
  const allowed = segments.every((segment) => segmentAllowed(segment, worktreePath));
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

/** Explicit Skippy MCP wiring: injected into every session this adapter runs. */
export interface ClaudeAdapterOptions {
  skippyMcpUrl: string;
  skippyMcpToken: string;
}

export class ClaudeAdapter implements HarnessAdapter {
  readonly harness = "claude" as const;

  constructor(private options: ClaudeAdapterOptions) {}

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
        let decision: Awaited<ReturnType<typeof request.requestApproval>>;
        try {
          decision = await request.requestApproval({
            harnessRequestId: `claude-${sessionId ?? "new"}-${approvalCounter}`,
            ...approval,
          });
        } catch (error: unknown) {
          // Never let a control-plane failure escape through canUseTool into
          // the SDK's control-request plumbing (see incident 2026-08-19:
          // errors there surface as unhandled rejections). Fail closed.
          console.error(
            `[skippy-runner] approval request failed inside canUseTool (session ${sessionId ?? "new"}):`,
            error,
          );
          return deny("Approval could not be obtained (control-plane error). Do not retry this action.");
        }
        if (decision === "accepted") return allow();
        if (decision === "cancelled") return deny("Run cancelled by the user.");
        if (decision === "timed_out") {
          return deny("Approval timed out before anyone decided. Stop and finish without this action.");
        }
        return deny("The user declined this action. Adjust your approach or finish without it.");
      };

      if (toolName === "Bash") {
        const command = String(input?.command ?? "");
        if (classifyCommand(command, worktreePath) === "allow") return allow();
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

    // Forward run/chat cancellation into the SDK so teardown is prompt and
    // goes through the SDK's own abort path instead of us abandoning the
    // stream mid-message. Late transport writes after this abort are the
    // known ProcessTransport race — logged by the backstops, never fatal.
    const sdkAbort = new AbortController();
    const onAbort = () => sdkAbort.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    const options: Record<string, unknown> = {
      cwd: worktreePath,
      // bypassPermissions = --dangerously-skip-permissions: canUseTool is
      // never consulted, so no approvals surface. Chat-only, opt-in.
      permissionMode: request.bypassPermissions ? "bypassPermissions" : "acceptEdits",
      canUseTool,
      // settingSources is deliberately KEPT: it provides host-level parity a
      // local session has (CLAUDE.md, hooks, any additional user/project MCP
      // servers). But the Skippy MCP no longer depends on it — the explicit
      // mcpServers entry below wins for the "skippy" name, so sessions get
      // Skippy tools even when ~/.claude.json registration is empty (the
      // silent 2026-08-18 regression this guards against).
      settingSources: ["user", "project", "local"],
      // Explicit Skippy MCP injection from runner config (SKIPPY_MCP_URL /
      // SKIPPY_MCP_TOKEN). Options are rebuilt every turn, so resumed
      // sessions heal automatically after a config fix + restart.
      mcpServers: {
        skippy: {
          type: "http",
          url: this.options.skippyMcpUrl,
          headers: { Authorization: `Bearer ${this.options.skippyMcpToken}` },
        },
      },
      abortController: sdkAbort,
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
              // Missing-tools alarm: a session without mcp__skippy* tools is
              // a misconfiguration that used to fail silently (2026-08-18:
              // host-level MCP registration vanished; sessions just had no
              // Skippy tools and nobody knew). Make it loud in the run feed.
              const tools: string[] = Array.isArray(message.tools) ? message.tools : [];
              const hasSkippyTools = tools.some((tool) => typeof tool === "string" && tool.startsWith("mcp__skippy"));
              if (!hasSkippyTools) {
                const serverStatuses = Array.isArray(message.mcp_servers)
                  ? message.mcp_servers.map((s: any) => `${s?.name}:${s?.status}`).join(", ")
                  : "unknown";
                const alarm =
                  `Skippy MCP tools are MISSING from this session (no mcp__skippy* tools). ` +
                  `MCP servers: [${serverStatuses}]. Check SKIPPY_MCP_URL/SKIPPY_MCP_TOKEN and the remote endpoint.`;
                console.error(`[skippy-runner] ${alarm} (session ${sessionId})`);
                onEvent({ type: "error", payload: { message: alarm, phase: "mcp_missing" } });
              }
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
      if (signal.aborted || isHarnessTeardownError(error)) {
        // Teardown race, not a real harness failure: the session was torn
        // down (interrupt/cancel/timeout) while the SDK still had work in
        // flight. Log it and report an orderly interruption — never crash,
        // never poison sibling sessions (incident 2026-08-19, run qx719evfy).
        if (!signal.aborted) {
          console.error(
            `[skippy-runner] harness session ${sessionId ?? "new"} hit a teardown-race transport error (suppressed):`,
            error,
          );
        }
        return { externalThreadId: sessionId, outcome: "interrupted" };
      }
      let messageText = error instanceof Error ? error.message : String(error);
      // A bare process exit is opaque; the session's last words usually carry
      // the real reason (usage limit, auth). Surface them together.
      if (/exited with code/i.test(messageText) && lastAssistantText) {
        messageText = `${messageText} — last message: "${lastAssistantText.slice(0, 200)}"`;
      }
      onEvent({ type: "error", payload: { message: messageText.slice(0, 500) } });
      return { externalThreadId: sessionId, outcome: "failed", errorMessage: messageText.slice(0, 500) };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
