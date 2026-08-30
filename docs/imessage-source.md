# iMessage Source (chat.db, read-only)

Skippy reads the local iMessage archive through `apps/imessage-mcp`, a tiny MCP
server we wrote ourselves — the third local connector after Plaid
(`docs/plaid-financial-source.md`) and Google (`docs/google-source.md`), per
`docs/connectors.md` (connector slug `imessage`, kind `local_data`).

Unlike Gmail/Calendar there is no vendor API and no OAuth: the data is a SQLite
file at `~/Library/Messages/chat.db` that Messages.app keeps synced on the mini.
Because the surface is so small, writing our own server was safer than auditing
a community one — the whole thing is ~4 small TypeScript files in this repo,
reviewed like any other PR.

## What it is

- `@skippy/imessage-mcp` (`apps/imessage-mcp`): stdio MCP server, no network
  access of any kind — it only opens the local SQLite file.
- **Read-only by construction**: the database is opened with SQLite's
  `readOnly` flag, and the package contains zero send/AppleScript/modify code.
  There is nothing to scope-block because no write capability exists.
- Uses `node:sqlite` (node >= 22.5), so there is no native-module build step.
  Its "experimental" warning goes to stderr only; the MCP protocol is on stdout.

### Tools (all read-only)

| Tool | Purpose |
| --- | --- |
| `list_recent_messages` | Newest messages across all chats; `since` (ISO 8601) for incremental reads |
| `search_messages` | Substring search, including typedstream-only rows (byte search on the blob) |
| `get_thread` | One conversation in chronological order, by `chat_identifier` |
| `list_chats` | Conversations by recent activity, with participants and last-message time |

### chat.db quirks the server normalizes

- **Dates**: `message.date` is nanoseconds since 2001-01-01 on modern macOS
  (plain seconds on pre-High-Sierra rows). Normalized to ISO 8601 UTC in SQL —
  raw nanosecond integers would overflow a JS number.
- **Text**: since ~Ventura many rows have `text = NULL` with the content only
  in the `attributedBody` typedstream blob. The server extracts the embedded
  NSString payload (`src/decode.ts`); rows where that fails are genuinely
  attachment-only (images, tapbacks) and return `text: null`.

## Setup steps

1. Build (from repo root): `pnpm --filter @skippy/imessage-mcp build`.
2. **Grant Full Disk Access (the one-time owner step).** macOS TCC gates
   `chat.db` regardless of unix permissions; without FDA every tool call
   returns an error pointing back here.
   - System Settings → Privacy & Security → Full Disk Access → `+` → add the
     **node binary** that runs the server (resolve symlinks:
     `readlink -f $(which node)`), and/or the terminal app for interactive
     sessions (children of an FDA-granted terminal inherit access).
   - For runner-spawned harness sessions, the responsible process is the node
     executable itself — grant it FDA and restart the runner.
3. Register with the harness (same pattern as Plaid/Google):

   ```bash
   claude mcp add -s user imessage -- \
     node /Users/skippy/src/skippy-mcp-and-app/apps/imessage-mcp/dist/stdio.js
   ```

   `claude mcp list` should show `✔ Connected`; tools appear in new sessions
   only.

4. Advertise the connector: add `imessage` to `SKIPPY_RUNNER_CONNECTORS`
   (comma-separated) in the runner's launchd environment and restart the
   runner.
5. Smoke test in a fresh session: `list_chats` with a small limit, then
   `list_recent_messages` with `since` = yesterday.

`IMESSAGE_DB_PATH` overrides the database path — used by tests and fixtures
only; production always reads the live archive.

## Security posture

- **Data never leaves the machine.** The server makes no network calls; the
  only I/O is reading the local SQLite file and answering over stdio.
- **Read-only by construction.** SQLite `readOnly` open + no write code paths.
  Any future write capability (sending via AppleScript, etc.) is a separate
  proposal requiring owner sign-off — do not add it casually.
- **What harnesses may do:** read/search messages, summarize, and ingest
  concise facts into Skippy with `sourceRefs`
  (`sourceSystem: "imessage"`, message `guid` as `externalId`,
  `sourceTimestamp` from the message date, participants from the chat).
- **What harnesses may NOT do:** store raw conversation dumps in Skippy
  (concise facts, short excerpts only); forward message contents to any
  third-party service; treat contact identifiers as public data.

## Troubleshooting

- `authorization denied` or `unable to open database file`: TCC — redo step 2
  for the actual binary opening the DB, then restart the session/runner.
- `ExperimentalWarning: SQLite` on stderr: harmless; from `node:sqlite`.
- Empty `text` on rows you can see in Messages.app: attachment/tapback rows,
  or a typedstream layout the decoder doesn't recognize — file it with the
  message `guid` so a fixture can be added to `src/decode.test.ts`.
