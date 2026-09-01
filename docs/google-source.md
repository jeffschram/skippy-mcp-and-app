# Google Source (Gmail + Calendar)

Skippy reads Gmail and Google Calendar through locally run, audited MCP servers —
the Plaid pattern (`docs/plaid-financial-source.md`) repeated for Google, per
`docs/connectors.md`. This document records which servers were chosen, the audit
findings, setup steps, and the rules harnesses must follow.

**Reads: live.** Both read-only servers are installed, consented, and registered
on the mini.

**Writes: one narrow exception.** A fourth server — `gcal-write`
(`apps/gcal-write-mcp`, written by us) — can create calendar events and nothing
else. It has its own OAuth scope, its own credential files, and its own
connector slug (`google_write`) so read access never implies write access. See
[Calendar writes](#calendar-writes-gcal-write) below.

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

## Calendar writes (`gcal-write`)

Owner decision (2026-09): Skippy may create events on the owner's **own primary
calendar**, not a separate "Skippy" calendar — "I honestly don't use it much and
it's more helpful to use my own." Two entry points are wanted: asking the Agenda
Agent in chat, and approving a suggestion an ingestion pass raises ("Helen asked
to meet tomorrow at 2pm, want to make a calendar event?").

### Why we wrote this one

The write-capable servers surveyed above were all rejected for the same reason:
they compile in full event CRUD and only *disable* writes by configuration. That
bar cuts both ways — a server that can delete events is not made safe by a
config flag, whichever direction the flag points. Rather than adopt one and
trust its configuration, `apps/gcal-write-mcp` is a few hundred lines we own,
with update/delete capability simply absent. A small thing we can read in one
sitting beats a large thing we can only configure.

### Capability surface

- **One tool: `create_event`.** No list, read, update, patch, or delete exists
  anywhere in the package. Reads stay with the read-only `gcal` server.
  `src/mcp-server.test.ts` asserts the exposed tool list is exactly
  `["create_event"]` — that test failing is a prompt for owner sign-off, not a
  snapshot to bump.
- **One HTTP endpoint:** `POST /calendar/v3/calendars/{id}/events`
  (`src/google.ts`).
- **Scope:** `https://www.googleapis.com/auth/calendar.events`, hardcoded in
  `src/config.ts`, not configurable. Google offers no narrower write scope that
  reaches an existing personal calendar (`calendar.app.created` only covers
  calendars the app itself created, which the owner explicitly did not want). So
  the scope is wider than what we use and the narrowing is done in code — the
  opposite arrangement from the servers rejected above, where the code was wide
  and only the scope was narrow.
- **Dependencies:** the MCP SDK, `zod`, and `@skippy/shared`. Deliberately *not*
  `googleapis` — this package should be auditable line-by-line like the
  third-party ones beside it, and a large SDK in the tree defeats that. The only
  hosts contacted anywhere are `accounts.google.com`, `oauth2.googleapis.com`,
  and `www.googleapis.com`.
- **Credentials:** `~/.config/gcal-write-mcp/credentials.json` and `token.json`,
  written 600 in a 700 directory, and `chmod`ed explicitly after write rather
  than relying on the open mode — that is the umask finding from the Gmail
  server, fixed at the source here. Token values are never logged; a failed
  refresh reports the HTTP status only, never the response body.
- **OAuth:** PKCE (S256) plus a fresh random `state` compared in constant time,
  improving on the read-only calendar server's static `state`. The loopback
  listener takes an ephemeral port (`:0`) so it cannot collide with that
  server's fixed `:8089`. Consent runs only under `--authorize`, an interactive
  owner-only path that **nothing in the MCP surface can trigger**.
- **Idempotency:** Skippy mints the Google event id before staging a write
  (`packages/shared/src/calendar.ts`), so a retry re-sends a known id and gets
  409 Conflict. This server reports 409 as **success** — "already created", not
  "create another". Treating it as failure is how calendars get double-booked.

### Approval, not autonomy

Nothing here decides *what* to create; this package is only the executor. Every
event travels as a `calendar_event_create` pendingAction the owner approves in
`/review` (`convex/calendar.ts` `draftCalendarEvent`). The agent proposes, the
owner approves, the runner executes; the MCP role allowlist grants agents the
propose side only.

### Write path (propose → approve → execute)

1. **Propose.** `propose_calendar_event` on the Skippy MCP server
   (`apps/mcp-server/src/tools.ts`) mints the event id and stages a
   `calendar_event_create` pendingAction. Whether it needs approval is decided
   by the **calling token's role**, not by the caller's arguments:

   | Caller | Token | `autoApprove: true` honored? |
   | --- | --- | --- |
   | Owner in chat | `SKIPPY_MCP_TOKEN` (role `null`) | yes — staged already approved |
   | Agent pass (e.g. agenda) | role-scoped token | **no** — forced to `pending_approval` |

   The forcing happens in `createSkippyToolHandlers`, which receives the role
   alongside the allowlist. A prompt is not a security boundary; an unattended
   pass told to "just add it" still lands in `/review`.

2. **Approve.** The owner taps Approve in `/review` → Actions
   (`reviewPendingActionForViewer`), moving the action to `approved`. Nothing
   calls Google yet — Convex holds no credentials and never will
   (`docs/connectors.md`).

3. **Execute.** The runner polls `calendar:claimNextCalendarAction` every 2s
   (chat speed, not the 5s claim speed: the owner is standing in the app having
   just tapped Approve). It leases the action for 150s exactly like runs and
   maintenance jobs, inserts the event, then reports through
   `calendar:recordCalendarActionResult`, which settles the pendingAction to
   `completed`/`failed` and syncs `remoteState` on the calendarEvents row.

   Re-claiming an expired lease is safe here, unlike elsewhere: the minted id
   means a duplicate execution comes back 409 and settles as "already created".
   A failure lands in `failed` with the Google error attached, where `/review`
   already renders it as re-reviewable.

   This loop only exists when `google_write` is in `SKIPPY_RUNNER_CONNECTORS`.
   Credentials being on disk is deliberately *not* sufficient — a host that
   offers Google reads must not start writing because a token file happens to
   be there. Without the slug the runner logs that the loop is disabled and
   approved actions simply wait.

**The runner links `@skippy/gcal-write-mcp` as a library, not as an MCP
server** (`apps/runner/src/calendarActionExecutor.ts`). The MCP wrapper exists
so *harnesses* can create events; the runner is not a harness and a JSON-RPC
hop would only add a subprocess, a protocol, and a failure mode between it and
an HTTP POST. Both paths share the same insert and auth code, so the two cannot
drift.

### Setup (owner)

1. In the Google Cloud project, add `.../auth/calendar.events` to the OAuth
   consent screen's scopes. Reuse the existing Desktop OAuth client JSON.
2. Place credentials and build:

   ```bash
   mkdir -p ~/.config/gcal-write-mcp && chmod 700 ~/.config/gcal-write-mcp
   cp <client-json> ~/.config/gcal-write-mcp/credentials.json
   chmod 600 ~/.config/gcal-write-mcp/credentials.json
   pnpm --filter @skippy/gcal-write-mcp build
   ```

3. One-time consent (browser opens). **Verify the screen lists only "View and
   edit events on all your calendars" — and tick its checkbox**; Google's newer
   consent screen leaves permissions unchecked, and clicking through without
   ticking yields a token missing the scope that fails later as an opaque 403:

   ```bash
   node apps/gcal-write-mcp/dist/stdio.js --authorize
   ```

4. Register and advertise:

   ```bash
   claude mcp add -s user gcal-write -- node \
     "$PWD/apps/gcal-write-mcp/dist/stdio.js"
   ```

   Then add `google_write` to `SKIPPY_RUNNER_CONNECTORS` in the runner's launchd
   environment and restart it. It is a **separate slug from `google`** on
   purpose: a host that offers Google reads must not implicitly offer writes.

5. Smoke test: create one event a day out, confirm it lands on the primary
   calendar, then delete it by hand (this server cannot).

### Changing this server

Adding a tool beyond `create_event`, widening the scope, or reaching a second
endpoint is a new capability, not a refactor: it needs an owner decision and an
update to this section. `pnpm connectors:check` verifies the build and
credential modes but cannot tell you the tool surface grew — the test in
`src/mcp-server.test.ts` is what does that.

## Security posture

- **Tokens stay local.** OAuth client JSON and refresh tokens live only in
  `~/.gmail-mcp/`, `~/.config/gcal-readonly-mcp/`, and
  `~/.config/gcal-write-mcp/` (chmod 600 files, 700 dirs), outside any git repo.
  They are never committed, printed, logged, or sent anywhere except Google.
- **Read-only by construction, with one audited exception.** Gmail and the
  `gcal` reader hardcode readonly scopes and contain no write API calls.
  `gcal-write` is the single exception and can only *create* calendar events
  (see above). Any further write capability — sending mail, editing or deleting
  events, labels — requires a new audit and owner sign-off.
- **Pinned commits.** The audit covers exactly the commits listed above. Do
  not `git pull` either clone casually: re-audit the diff (scopes, new tools,
  new network calls, credential handling) before checking out anything newer,
  and update this document with the new audited commit hash.
- **What harnesses may do:** search/read email and calendar data, summarize,
  and ingest concise facts into Skippy with `sourceRefs`
  (`sourceSystem: "gmail"` / `"google_calendar"`, message/event id as
  `externalId`, and a `sourceTimestamp`); propose a calendar event, which the
  owner approves before anything reaches Google.
- **What harnesses may NOT do:** echo tokens or client secrets into logs,
  transcripts, or commits; store raw mailbox dumps in Skippy (concise facts,
  not full bodies, unless a task requires an excerpt); send mail, or edit or
  delete anything (impossible via these servers — keep it that way); create a
  calendar event without an approval (the only write path is `create_event`,
  and it exists to serve an approved action, not to act on a hunch); download
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
