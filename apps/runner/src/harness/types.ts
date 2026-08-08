/**
 * Provider-neutral harness adapter contract
 * (docs/mac-mini-agent-workbench.md → Harness adapter responsibilities).
 *
 * Neither Codex App Server events nor Claude Agent SDK messages are the Skippy
 * protocol; adapters translate their native shapes into HarnessEvent and route
 * sensitive actions through the approval gate.
 */

export type HarnessEventType =
  | "assistant_message"
  | "plan_update"
  | "command"
  | "command_result"
  | "file_change"
  | "usage"
  | "status"
  | "error";

export interface HarnessEvent {
  type: HarnessEventType;
  /** Safe, redacted, JSON-serializable payload. */
  payload: Record<string, unknown>;
}

export interface ApprovalRequest {
  /** Stable per-request id, so a retried decision cannot approve another action. */
  harnessRequestId: string;
  kind: "command" | "file_change" | "network" | "secret" | "push" | "pr" | "deployment" | "user_input";
  title: string;
  explanation?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface HarnessTurnRequest {
  /** Prompt for this turn (task brief + acceptance criteria on the first turn). */
  prompt: string;
  /** Harness-native thread/session id to resume, when the chat has one. */
  externalThreadId?: string;
  /** Absolute path of the dedicated worktree the harness must stay inside. */
  worktreePath: string;
  signal: AbortSignal;
  /** Adapter emits translated events here as the turn streams. */
  onEvent: (event: HarnessEvent) => void;
  /**
   * Adapter calls this before any action outside the auto-allow policy and
   * blocks until the user decides. Returning "cancelled" means the run is
   * being torn down and the adapter should stop.
   */
  requestApproval: (request: ApprovalRequest) => Promise<"accepted" | "declined" | "cancelled">;
}

export interface HarnessTurnResult {
  /** Harness-native thread/session id for resuming the conversation later. */
  externalThreadId?: string | undefined;
  outcome: "completed" | "interrupted" | "failed";
  /** Final assistant summary text, when the harness produced one. */
  resultText?: string | undefined;
  errorMessage?: string | undefined;
}

export interface HarnessAdapter {
  readonly harness: "codex" | "claude";
  runTurn(request: HarnessTurnRequest): Promise<HarnessTurnResult>;
}
