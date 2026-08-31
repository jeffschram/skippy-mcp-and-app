# Google Source (Gmail + Calendar, read-only)

Skippy reads Gmail and Google Calendar through locally run, audited MCP servers —
the Plaid pattern (`docs/plaid-financial-source.md`) repeated for Google, per
`docs/connectors.md`. This document records which servers were chosen, the audit
findings, setup steps, and the rules harnesses must follow.

**Status: audited, pending owner sign-off.** Nothing has been installed and no
OAuth consent has been granted. Approving the PR that adds this document is the
sign-off; the "Setup steps" section below is executed only after that.

## Survey and shortlist

Community MCP servers surveyed (2026-08). Hard requirements: `gmail.readonly` +
`calendar.readonly` scopes ONLY; no telemetry or third-party network calls (only
Google APIs); no send/modify/delete tools reachable at all (not merely
scope-blocked); credentials read from local disk, never transmitted elsewhere.

| Candidate | Verdict |
| --- | --- |
| `github.com/Maheidem/gmail-mcp` (`mcp-gmail-reader`) | **Chosen for Gmail.** Python/FastMCP, ~550 LOC of source. `gmail.readonly` hardcoded as the only scope. Read-only tools only. Audit below. |
| `github.com/jeremyjordan/mcp-gmail` | Rejected: hardcodes the `gmail.modify` scope. |
| `github.com/GongRzhe/Gmail-MCP-Server`, `github.com/theposch/gmail-mcp` | Rejected: send/trash/label/draft tools are registered and reachable; theposch also uses `gmail.modify` (and is GPL-3.0). |
| `github.com/geraldcroes/gcal-readonly-mcp` | **Chosen for Calendar.** Go, ~1,000 LOC. `calendar.readonly` hardcoded as the only scope; token files written 0600 in 0700 dirs by the code itself. Audit below. |
| `github.com/nspady/google-calendar-mcp` | Rejected: full CRUD event tools compiled in; write tools only disabled by configuration, not absent. |
| `github.com/deciduus/calendar-mcp` | Rejected: write tools present even when configured with the readonly scope; AGPL-3.0. |

Both chosen repos are young with tiny communities, which is acceptable here
precisely because they are small enough to audit line-by-line — the audit, plus
pinning the audited commit, is the trust anchor, not popularity (same reasoning
as `plaid-mcp`).

Clones live in `~/src/` — outside this repo; the audited servers are never
vendored here (different languages, and vendoring would sever the upstream
re-audit path):

- `~/src/gmail-mcp-audit` — audited at commit `e054cf1efe82e386552bf8e1e6d0115f5ac86c3e`
- `~/src/gcal-readonly-mcp-audit` — audited at commit `b75c062b51f10aebd5f865c15789bec1515478b2`

Those commits are pinned machine-readably in **`scripts/connectors.json`**,
which is the canonical pin; this document keeps the audit findings and security
posture. `pnpm connectors:check` (= `node scripts/setup-connectors.mjs`)
verifies a host against it: checkout at the pinned SHA, clean worktree, built
artifact, credential files at mode 600, and MCP registration. `--install`
reconciles clones and builds; `--register` adds missing MCP servers. Credential
placement and OAuth consent stay manual, owner-only steps — the script reports
them, never performs them.

## Audit findings

Method: every source file of both chosen candidates was read in full, plus a
repo-wide grep for URLs, sockets, subprocess use, and telemetry/analytics
keywords. Test files were checked to be mock-only (no network).

### Gmail — `Maheidem/gmail-mcp` @ `e054cf1` (MIT)

Files: `pyproject.toml`, `src/gmail_mcp/{__init__,__main__,auth,gmail_client,server}.py`,
`tests/*` (mock fixtures only).

- **Scopes:** `auth.py` defines `SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]`
  — the only scope in the codebase; every credential load and OAuth flow uses it.
- **Network:** dependencies are the official Google stack only
  (`google-api-python-client`, `google-auth-oauthlib`, `google-auth-httplib2`)
  plus the MCP SDK. The only endpoints reachable are Google OAuth and the Gmail
  API. Repo-wide grep found no other URL, no telemetry, no analytics.
- **Tools (all read-only):** `search_emails` (`messages.list`), `get_email`
  (`messages.get`), `download_attachment` / `get_email_with_attachments`
  (`messages.attachments.get`, writes the file to a caller-chosen local path),
  `auth_status` and `reauth` (`users.getProfile`; `reauth` deletes the local
  token and reruns the browser OAuth flow). No send/trash/modify/label/draft
  API call exists anywhere in the code.
- **Credentials:** OAuth client keys read from `~/.gmail-mcp/gcp-oauth.keys.json`,
  token stored at `~/.gmail-mcp/token.json` (both overridable via
  `GMAIL_CREDENTIALS_PATH` / `GMAIL_TOKEN_PATH`). Consent flow is
  `InstalledAppFlow.run_local_server(port=0)` — localhost only. Tokens are only
  ever sent to Google for refresh/API calls.
- **Findings to mitigate at setup:** (1) the token file is written without an
  explicit mode, so it inherits the umask — `chmod 600` it right after consent
  (step 4 below). (2) `download_attachment` writes to any caller-supplied path;
  harnesses must only pass paths inside their workspace.

### Calendar — `geraldcroes/gcal-readonly-mcp` @ `b75c062` (MIT)

Files: `go.mod`, `main.go`, `config.go`, `auth.go`, `calendar.go`, `server.go`,
`server_test.go` (fixtures only).

- **Scopes:** `auth.go` defines `oauthScopes = []string{calendar.CalendarReadonlyScope}`
  — the only scope in the codebase.
- **Network:** only the official Google API Go client and `golang.org/x/oauth2`;
  the only endpoints reachable are Google OAuth and the Calendar API. The
  OpenTelemetry packages in `go.sum` are transitive dependencies of
  `google.golang.org/api` (in-process instrumentation); no exporter is
  configured anywhere, so nothing is emitted off-machine. During `--add-account`
  only, a temporary localhost callback server listens on `:8089` and the
  default browser is opened via `exec.Command("open", url)`; both are local.
- **Tools (all read-only):** `list_accounts` (local config read),
  `list_calendars` (`CalendarList.List`), `list_events` (`Events.List`),
  `get_event` (`Events.Get`), `check_availability` (`Freebusy.Query`). No
  insert/update/delete call exists anywhere in the code.
- **Credentials:** OAuth client JSON at
  `~/.config/gcal-readonly-mcp/credentials.json`; per-account tokens at
  `~/.config/gcal-readonly-mcp/tokens/<account>.json`. The code itself writes
  tokens/config 0600 and directories 0700. Multi-account is supported but we
  configure a single account.
- **Minor note:** the OAuth flow uses a static `state` parameter; negligible
  risk for a one-time, owner-driven consent on a localhost callback.

## Setup steps (after owner sign-off only)

1. Owner creates (or reuses) a Google Cloud project with the Gmail API and
   Calendar API enabled, and a Desktop-app OAuth client. Download the client
   JSON. This client JSON and all tokens live outside any git repo and are
   never committed, printed, or logged.
2. Gmail server (pin to the audited commit):

   ```bash
   cd ~/src/gmail-mcp-audit
   git checkout e054cf1efe82e386552bf8e1e6d0115f5ac86c3e
   python3 -m venv .venv && ./.venv/bin/pip install -e .
   mkdir -p ~/.gmail-mcp && chmod 700 ~/.gmail-mcp
   cp <client-json> ~/.gmail-mcp/gcp-oauth.keys.json && chmod 600 ~/.gmail-mcp/gcp-oauth.keys.json
   ```

3. Calendar server (pin to the audited commit):

   ```bash
   cd ~/src/gcal-readonly-mcp-audit
   git checkout b75c062b51f10aebd5f865c15789bec1515478b2
   go build -o gcal-readonly-mcp .
   mkdir -p ~/.config/gcal-readonly-mcp && chmod 700 ~/.config/gcal-readonly-mcp
   cp <client-json> ~/.config/gcal-readonly-mcp/credentials.json && chmod 600 ~/.config/gcal-readonly-mcp/credentials.json
   ```

4. **Owner performs the one-time OAuth consents** (browser opens; verify the
   consent screen lists ONLY "View your email messages and settings" /
   "View your calendars"):

   ```bash
   # Gmail: first tool call triggers the flow; easiest is one manual run
   cd ~/src/gmail-mcp-audit && ./.venv/bin/python -c "from gmail_mcp.auth import get_credentials; get_credentials()"
   chmod 600 ~/.gmail-mcp/token.json   # mitigates the umask finding above

   # Calendar
   cd ~/src/gcal-readonly-mcp-audit && ./gcal-readonly-mcp --add-account personal
   # token written 0600 by the server itself
   ```

5. Register with the harness (same pattern as the Plaid server):

   ```bash
   claude mcp add -s user gmail -- \
     ~/src/gmail-mcp-audit/.venv/bin/python -m gmail_mcp
   claude mcp add -s user gcal -- \
     ~/src/gcal-readonly-mcp-audit/gcal-readonly-mcp
   ```

   `claude mcp list` should show both `✔ Connected`; tools appear in new
   sessions only.

6. Advertise the connector: add `google` to `SKIPPY_RUNNER_CONNECTORS`
   (comma-separated, e.g. `plaid,imessage,google`) in the runner's launchd
   environment and restart the runner. `registerHost` then publishes it in
   `agentHosts.capabilities.connectors` and the connector inventory shows
   "google" as provided by the mini.

7. Smoke test read-only end-to-end: in a fresh session, `search_emails` with a
   narrow query and `list_events` for the next 7 days.

## Security posture

- **Tokens stay local.** OAuth client JSON and refresh tokens live only in
  `~/.gmail-mcp/` and `~/.config/gcal-readonly-mcp/` (chmod 600 files, 700
  dirs), outside any git repo. They are never committed, printed, logged, or
  sent anywhere except Google.
- **Read-only by construction.** Both servers hardcode the readonly scope and
  contain no write API calls. Any write capability (send, event creation,
  labels) requires a new audit and owner sign-off.
- **Pinned commits.** The audit covers exactly the commits listed above. Do
  not `git pull` either clone casually: re-audit the diff (scopes, new tools,
  new network calls, credential handling) before checking out anything newer,
  and update this document with the new audited commit hash.
- **What harnesses may do:** search/read email and calendar data, summarize,
  and ingest concise facts into Skippy with `sourceRefs`
  (`sourceSystem: "gmail"` / `"google_calendar"`, message/event id as
  `externalId`, and a `sourceTimestamp`).
- **What harnesses may NOT do:** echo tokens or client secrets into logs,
  transcripts, or commits; store raw mailbox dumps in Skippy (concise facts,
  not full bodies, unless a task requires an excerpt); send mail or modify
  anything (impossible via these servers — keep it that way); download
  attachments outside the run's workspace; forward email/calendar contents to
  any third-party service.

## Re-audit guidance for upgrades

When either upstream repo ships something worth adopting:

1. Fetch, but do not check out, the new commits; read the full diff from the
   audited commit.
2. Re-verify the hard requirements: scope constants unchanged
   (`gmail.readonly` / `calendar.readonly` only), no new network destinations,
   no write-capable API calls or tools, credential paths still local-only.
3. Check new/changed dependencies (`pyproject.toml` / `go.mod`) the same way.
4. Check out the new commit, update the pinned hash + findings here **and in
   `scripts/connectors.json`** (the two must never disagree — `pnpm
   connectors:check` compares the host against the manifest, so a stale
   manifest silently blesses unaudited code), and note the re-audit date. Owner
   sign-off is required again if any finding is non-trivial.
