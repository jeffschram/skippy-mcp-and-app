# Plaid Financial Source (Sandbox POC)

Skippy can ingest financial facts (balances, unusual transactions, recurring payment
patterns) from bank data exposed through a locally run, audited Plaid MCP server.
This document records the sandbox proof-of-concept: which server was chosen, how it
was set up, and the rules harnesses must follow when handling financial data.

## Chosen server and audit result

Two community servers were cloned and audited (into `~/src/`, outside this repo):

| Repo | Verdict |
| --- | --- |
| `github.com/iteaguy/plaid-mcp` | **Chosen.** Single ~180-line FastMCP Python server (`server.py`). Only network dependency is the official `plaid-python` SDK talking to the Plaid API. Config and access tokens live in a gitignored, chmod-600 `config.json` next to the server. Tools are strictly read-only: `list_linked_accounts`, `get_balances`, `get_transactions`, `get_spending_summary`. No payments, transfers, or write endpoints anywhere in the code. The bundled `link.py` (browser-based Plaid Link flow) is not needed for sandbox and was not run. |
| `github.com/reilly3000/tool-plaid` | Functional and also read-only, but heavier: encryption layer, pluggable file/Postgres storage, cwd-relative data dir, required `ENCRYPTION_KEY` env. More surface to audit for no added benefit at this stage. |

Audit method: every source file of both candidates was read in full. Verified: only
Plaid API endpoints are called (`sandbox.plaid.com` / `production.plaid.com` via the
official SDK), tokens are stored locally, no telemetry or third-party network calls,
and no money-moving endpoints (payments/transfers) are reachable.

Server location: `~/src/plaid-mcp` with its own venv at `~/src/plaid-mcp/.venv`.

## Setup steps

1. Plaid credentials live at `~/.plaid/credentials.json` (chmod 600), with keys
   `client_id`, `sandbox_secret`, `production_secret`. **Never** print, log, or
   commit these values; load them programmatically.
2. Install server dependencies:

   ```bash
   cd ~/src/plaid-mcp
   python3 -m venv .venv
   ./.venv/bin/pip install plaid-python fastmcp
   ```

3. Create `~/src/plaid-mcp/config.json` (gitignored, chmod 600) with placeholder
   values replaced from the credentials file:

   ```json
   {
     "client_id": "PLAID_CLIENT_ID",
     "secret": "PLAID_SANDBOX_SECRET",
     "env": "sandbox",
     "access_tokens": {}
   }
   ```

## How the sandbox item was created (no browser needed)

Plaid's sandbox lets you mint a test bank connection purely via API — no Plaid Link
UI required:

1. `POST https://sandbox.plaid.com/sandbox/public_token/create` with
   `institution_id: "ins_109508"` (First Platypus Bank) and
   `initial_products: ["transactions"]`.
2. `POST /item/public_token/exchange` with the returned `public_token` to get a
   permanent `access_token` + `item_id`.
3. Store the access token in the server's `config.json` under `access_tokens`
   (and a copy in `~/.plaid/sandbox_item.json`, chmod 600). Tokens never leave the
   local machine.

Verified with direct API calls: `/accounts/balance/get` returned 12 test accounts
(checking, savings, credit card, 401k, mortgage, etc.) and `/transactions/sync`
returned 48 transactions. Note: `/transactions/sync` can return
`PRODUCT_NOT_READY`-style empty pages for a short period after item creation —
retry with backoff.

Also verified end-to-end over MCP stdio (JSON-RPC `initialize` → `tools/list` →
`tools/call`): all four tools returned live sandbox data.

## MCP registration

```bash
claude mcp add -s user plaid -- \
  /Users/jeffschram/src/plaid-mcp/.venv/bin/python \
  /Users/jeffschram/src/plaid-mcp/server.py
```

`claude mcp list` shows `plaid … ✔ Connected`. The `mcp__plaid__*` tools appear in
**new** Claude Code sessions only — an already-running session will not see them.

## Security posture

- **Tokens stay local.** Plaid access tokens live only in the server's gitignored
  `config.json` and `~/.plaid/` (both chmod 600). They are never committed, printed,
  or sent anywhere except the Plaid API.
- **Sandbox vs production secrets.** Sandbox work uses `sandbox_secret` +
  `https://sandbox.plaid.com` exclusively. `production_secret` must never be used by
  automated harnesses without an explicit owner-approved task.
- **Read-only.** The server exposes only read endpoints. No payments, transfers,
  or item-modification tools exist. Keep it that way; any write capability requires
  a new audit and owner sign-off.
- **What harnesses may do with financial data:** read balances/transactions,
  summarize, detect anomalies and recurring patterns, and ingest concise facts into
  Skippy with source refs.
- **What harnesses may NOT do:** echo secrets or full access tokens into logs,
  transcripts, or commits; store raw transaction dumps in Skippy (store concise
  facts, not full ledgers); send financial data to any third-party service; touch
  production credentials or initiate any money movement.

## Rubric guidance for financial facts

- **Clears the bar:** balance snapshots that change decisions (e.g., available cash
  below an upcoming autopay), large or unusual transactions (size outliers,
  charge/refund mismatches across accounts, unknown merchants), recurring payment
  patterns and their deviations (missed payroll, failed autopay), and anything
  fraud- or security-shaped.
- **Does not clear the bar:** routine purchases (coffee, rideshares, groceries),
  small recurring charges already known, or raw transaction lists with no signal.
- **API facts are ground truth.** Data returned by the Plaid API needs no human
  review before ingestion — ingest via `ingest_object` with a `rubricDecision`,
  `sourceRefs` using `sourceSystem: "plaid"`, an `externalId` (transaction_id or
  account mask), and a `sourceTimestamp`.
- Sandbox POC objects are titled `Plaid sandbox POC: …` so they are recognizable
  and deletable once real connections exist.

## Trial / production upgrade path

- Plaid's free trial includes **10 real-bank connections**, including OAuth banks
  like Chase — enough to connect the household's actual accounts without a paid
  plan.
- Production requires Plaid's production application/approval process; an owner
  task exists for that application. Until it is approved, all automated work stays
  on sandbox.
- When production access lands: real banks are linked via the Plaid Link flow
  (`link.py` in the server repo, or a hosted link), the resulting access tokens go
  into the same local `config.json` with `"env": "production"` and
  `production_secret`, and the sandbox POC objects in Skippy should be deleted.
