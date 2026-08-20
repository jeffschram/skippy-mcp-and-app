/**
 * Classifier for errors caused by a harness session being torn down while
 * work was still in flight.
 *
 * Incident 2026-08-19 (run qx719evfy): the runner tore down a Claude SDK
 * harness (SIGTERM, exit 143) while a `can_use_tool` control request was
 * pending. The SDK's `Query.readMessages` dispatches `handleControlRequest`
 * without awaiting it, so when the response write hit the dead transport the
 * resulting `ProcessTransport is not ready for writing` surfaced as an
 * unhandled rejection — outside any adapter try/catch — and crashed the whole
 * daemon, killing an unrelated in-flight chat turn.
 *
 * These messages come from the SDK's ProcessTransport.write guards
 * (@anthropic-ai/claude-agent-sdk sdk.mjs) plus the generic Node stream
 * failure modes you get writing to a dead child process. Used by the adapter
 * (to downgrade caught errors to a log line) and by the process-level
 * backstops in main.ts (to keep the daemon alive when an escape like the one
 * above happens anyway).
 */
export function isHarnessTeardownError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "");
  return (
    /ProcessTransport is not ready for writing/i.test(message) ||
    /Cannot write to terminated process/i.test(message) ||
    /Cannot write to process that exited/i.test(message) ||
    // SIGTERM teardown only (exit 143). A plain non-zero exit (e.g. code 1 on
    // a usage-limit failure) is a REAL harness failure and must still surface.
    /Claude Code process terminated by signal/i.test(message) ||
    /Claude Code process exited with code 143/i.test(message) ||
    /AbortError/i.test(message) ||
    /Operation aborted/i.test(message) ||
    /EPIPE/i.test(message) ||
    /ERR_STREAM_DESTROYED/i.test(message) ||
    /write after end/i.test(message)
  );
}
