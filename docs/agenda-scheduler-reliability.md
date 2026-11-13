# Agenda scheduler reliability

The November 13 scheduled diagnostic's first Google calls reached Codex's MCP dispatch and failed with `MCP tool codex_apps/gmail.get_profile is not available to the model` (same failure for Calendar). The next fresh session called those same tools successfully. This was a model/tool availability failure before a Google API response, not evidence of revoked Google credentials. Its cause remains unresolved. The separate legacy calendar mirror's HTTP 400 token-refresh error is a different failure.

The scheduler now assigns `agent-pass:<configId>:<claimVersion>` as the ingestion run ID. Agenda must use it for its immutable source manifest, source claims and terminal report. Backend completion checks the exact brain/run index and requires a terminal completed Agenda report from the current attempt. Missing, running or failed reports turn a normal harness exit into a failed scheduler result. The existing durable ingestion API validates per-source coverage before accepting a completed report; diagnostic runs without that report are intentionally not successful ingestion.

Failed Agenda attempts receive persisted 1-, 5- and 15-minute retries, then return to normal cadence. Interval quiet hours are respected. Retries use fresh scheduler attempt IDs; the source-progress layer preserves failed windows and receipts for replay. Disabled/unscheduled configs receive no next due time. Abrupt process loss still depends on lease expiry and the existing next scheduled slot; this change does not introduce a separate crash-recovery queue.

Expired claims cannot complete. The runner prevents simultaneous claim requests while polling. Agenda refuses to launch without its scoped MCP token or a server-supplied run ID; other roles retain their existing compatibility behavior. The LaunchAgent installer preserves existing role tokens when they are omitted from the install environment and XML-escapes explicit replacements. No new credential store is introduced.

## Rollout and qualification

Deploy the backend before the updated runner: the new runner fails closed if an older server omits runId. Keep Agenda paused while publishing the coordinated backend, skill and runner changes. A brain-specific skill override must also honor the supplied runId; otherwise completion correctly fails. Resume only the intended owner with approved account/calendar scopes. Calendar mirror and external writes are unaffected.

Local checks exercise correlated success, missing/failed/running/stale reports, expired workers, retry exhaustion/quiet hours, and missing scoped credentials. Read-only scheduled diagnostics exercise native connector access on the existing installed runner; they do not validate this undeployed completion code. After publication, test a persisted failed aggregate followed by a successful same-window replay under the final Agenda runtime. Do not infer migration acceptance from these unit tests or sampled reads. Messages provider identity, Calendar reconciliation and full persisted qualification remain separate blockers.

Codex app metadata alone does not establish runtime callability; official context: https://learn.chatgpt.com/docs/app-server . Refresh discovery once on a tool-availability failure, preserve the error category, and let bounded fresh-attempt retry handle remaining failures. Do not bypass authorization with another reader.

## Verification for this change

`pnpm check` passed all workspace and Convex typechecks and 1,297 tests. Focused scheduler/ingestion tests passed 37 cases. The LaunchAgent fragment was separately exercised against a temporary plist for preservation, explicit replacement, XML escaping and explicit empty removal; the installer itself was not run against the live host. `bash -n` and `git diff --check` passed.
