# Connectors & Agent Runtime

Status: Proposed (Phase 6 design note — implementation tasks follow this spec)

## Summary

Phase 5 (`docs/agents.md`) established agents as roles: skills for
instructions, token scope for access, role strings for attribution. Two layers
were left outside Skippy: *how agents reach external systems* (Google, iMessage,
Plaid) and *who owns their configuration and schedules* (today: a claude.ai
cloud routine and hand-edited prompts). This phase completes the model:

- **Connectors** — a first-class inventory of named access to external
  systems. Metadata only; credentials never leave the host.
- **Agent configs** — the pre-planned promotion of role strings to records:
  `agent = role key + skills + connectors + schedule + scoped token`.
- **Agent scheduling in the runner** — the existing mac-mini runner daemon
  grows a second poll loop: due agent configs are claimed and executed exactly
  like agent runs are today.

Settled decisions (owner, this phase):

1. **Clean, mini-only runtime.** The Mac mini is the single agent host. No
   hosted-connector fallback. The claude.ai Gmail/Calendar routine is retired
   once the self-hosted Agenda Agent validates in a parallel run.
2. **Connectors are inventory, never credential storage.** OAuth/refresh
   tokens and API secrets stay local on the host, chmod-600, exactly like the
   Plaid setup (`docs/plaid-financial-source.md`).
3. **Role strings stay the attribution keys.** `metadata.role` on run records
   is unchanged; `agentConfigs.roleKey` becomes the foreign key. No backfill.

## The model

```
Connector   = named access to an external system   (google, imessage, plaid)
Skill       = versioned instructions               (agenda-ingestion, finance-sync, project-manager)
Agent       = roleKey + skills + connectors + schedule + scoped token
Run         = (agent, harness, work), executed by the mini runner, attributed by roleKey
```

Skills reference connectors in prose ("read gmail/calendar"); **agent configs
declare them as structured data**. That split keeps skills portable and prose-
first while giving the runner something machine-checkable: *can this host run
this agent right now?*

## `connectors` table

```ts
connectors: defineTable({
  brainInstanceId: v.id("brainInstances"),
  slug: v.string(),                    // "google", "imessage", "plaid"
  displayName: v.string(),             // "Google (Gmail + Calendar)"
  kind: v.union(
    v.literal("local_mcp"),            // audited MCP server on the host (plaid pattern)
    v.literal("local_data"),           // direct local data access (imessage db)
    v.literal("http_feed"),            // token-authed HTTP push/pull (calendar-sync)
  ),
  readOnly: v.boolean(),               // plaid/google/imessage: true
  status: v.union(v.literal("pending"), v.literal("active"), v.literal("retired")),
  docsPath: v.optional(v.string()),    // "docs/plaid-financial-source.md"
  notes: v.optional(v.string()),       // setup/audit notes; NEVER secrets
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_brain_slug", ["brainInstanceId", "slug"])
```

**Availability is a host capability, not a connector field.**
`agentHosts.capabilities` gains `connectors?: string[]` (the slugs this host
provides), mirroring how `harnesses` already gates run claiming. A connector
is *usable* when some non-revoked, recently-heartbeating host lists it. The
settings UI derives a live availability map from the two tables.

Seed inventory: `plaid` (local_mcp, active, read-only), `imessage`
(local_data, active, read-only), `google` (local_mcp, pending — stood up by
this phase).

## `agentConfigs` table

```ts
agentConfigs: defineTable({
  brainInstanceId: v.id("brainInstances"),
  roleKey: v.string(),                 // "agenda" | "finance" | "task-executor" | "pm:{projectId}"
  displayName: v.string(),             // derived default, editable
  skillSlugs: v.array(v.string()),     // ["harness-bootstrap", "agenda-ingestion"]
  connectorSlugs: v.array(v.string()), // ["google", "imessage"]
  mcpTokenId: v.optional(v.id("mcpTokens")),  // the role-scoped token (see Secrets)
  preferredHarness: v.optional(agentHarness), // falls back like task runs do
  schedule: v.optional(agentSchedule),        // absent = manual/triggered only
  enabled: v.boolean(),
  // scheduling state (see Claiming)
  nextDueAt: v.optional(v.number()),
  lastRunStartedAt: v.optional(v.number()),
  lastRunStatus: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
  claimedByHostId: v.optional(v.id("agentHosts")),
  claimToken: v.optional(v.string()),
  claimVersion: v.number(),
  leaseExpiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_brain_role", ["brainInstanceId", "roleKey"])
  .index("by_brain_due", ["brainInstanceId", "enabled", "nextDueAt"])
```

Seed configs for the four known roles. `task-executor` gets no schedule — the
runner's existing task-claim loop *is* its execution path; the config exists
for inventory, token binding, and UI completeness.

### Schedule representation

The life-recurrence engine (`packages/shared/src/recurrence.ts`) is
day-granular (`everyDays`, RRULE without BYHOUR) and completion-anchored —
wrong shape for "agenda every 30 minutes" or "PM nightly at 23:30". Agent
schedules get their own small union, reusing the shared time-zone helpers
(`zonedTimestamp`) rather than the rule engine:

```ts
type AgentSchedule =
  | { kind: "interval"; everyMinutes: number }                       // agenda: 30
  | { kind: "daily"; timesOfDay: string[]; timeZone?: string };      // pm: ["23:30"]
```

`nextDueAt` is the single source of truth for due-ness (same pattern as
recurrences). It is **schedule-anchored**: advanced from the scheduled slot,
not from completion, so a slow run does not drift the cadence. Missed slots
(mini asleep/offline) collapse to one catch-up run: on claim, `nextDueAt`
advances to the next *future* occurrence.

### Claiming and leases

Reuse the agentWorkbench discipline verbatim (`RUN_LEASE_MS = 150s`, claim
token + incrementing `claimVersion`, heartbeat renewal, no auto-restart on
lease expiry):

1. Runner polls `claimNextAgentPass()` alongside `claimNextRun()`.
2. A config is claimable when `enabled && nextDueAt <= now && no live lease`
   and the host's capabilities include the config's `connectorSlugs` and a
   supported harness.
3. Claiming atomically sets the lease **and advances `nextDueAt`** — the
   double-fire guard.
4. The runner heartbeat renews leases for active passes; an expired lease
   surfaces as a failed pass for reconciliation, never a silent duplicate.

### Run history

v1 adds **no new runs table**. The skills already record their own runs
(`record_ingestion_run` / digests) with `metadata.role`, which the UI renders
role-first since Phase 5. The config keeps only `lastRunStartedAt` /
`lastRunStatus` for the settings list. If agent passes later need first-class
history (retries, per-pass artifacts), promote then — same philosophy as the
deferred `agentRoles` table in Phase 5, which this table now fulfils.

## Executing an agent pass

The runner starts the configured harness (reusing the existing adapter
infrastructure) with:

- **MCP connection to Skippy** using the config's scoped token — so the
  allowlist from Phase 5 is enforced at the transport, not by trust.
- **The host's local connectors** (google/plaid MCP servers, imessage access)
  as additional tools, per the harness's normal MCP registration.
- **A one-line prompt**: load the config's role skill(s) via `get_skill` and
  follow them. For `pm:{projectId}` configs the projectId is appended, exactly
  like the `skippy_project_manager` prompt argument.

Everything behavioral stays in the versioned skills. The runner contributes
only scheduling, credentials plumbing, and process supervision.

### Secrets

`mcpTokens.create` returns plaintext once. The agent config stores the token
*document id* (for display/revocation); the **plaintext lives only on the
mini** in the runner's local config (chmod-600, same treatment as host
tokens and Plaid credentials). Connector credentials (Google OAuth refresh
token) likewise never touch Convex.

## Settings UI

Two additions to the settings hub (alongside the existing "Agent hosts" tab):

- **Connectors tab** — the inventory with live availability (which host
  provides it, last relevant sync), status, and docs links.
- **Agents tab** — one row per agent config: role, skills, connectors,
  schedule (editable — this is the owner-facing payoff), enabled toggle,
  token binding (with role-scoped token creation inline, closing the "role
  picker" follow-up from Phase 5), and last-run status.

## Migration & cutover

1. Ship inventory + configs + runner loop with everything `enabled: false`.
2. Stand up the `google` connector (audited local Gmail/GCal MCP server,
   Plaid pattern; owner does the one-time OAuth consent).
3. Enable the `agenda` config on a schedule; parallel-run against the
   claude.ai routine. Role attribution makes comparison trivial: self-hosted
   passes appear as "Agenda Agent · on claude/codex" with full MCP fidelity
   (quick captures + focus refresh); routine runs keep arriving via `/ingest`.
4. Owner disables the claude.ai routine and revokes its full-access token.
5. Enable `finance` and `pm:{projectId}` configs the same way; delete the
   interim scheduler prompts. `/ingest` remains supported as an endpoint but
   has no scheduled caller.

## Non-goals

- **No credential storage in Convex.** Inventory and state only.
- **No new runs table** in v1 (see Run history).
- **No hosted/cloud agent hosts.** `agentHosts.kind: "cloud"` remains in the
  schema but nothing in this phase targets it — mini-only by decision.
- **No connector SDK/abstraction layer.** A connector is a slug plus locally
  configured access; the harness uses whatever tools the host registers.

## Open questions for the owner

1. **Default schedules** — proposal: agenda `interval` every 30 min (07:00–22:00
   quiet hours worth adding to the union?), finance `daily ["06:30"]`, PM
   `daily ["23:30"]` per active project. Tune after the first week of digests.
2. **Quiet hours / windows** — the two-variant schedule union is deliberately
   minimal. If "only between 7am and 10pm" matters for agenda, we add an
   optional `window` to the interval variant now rather than later.
3. **Pass visibility** — is `lastRunStatus` in settings plus the existing
   role-attributed run logs enough, or do you want a "recent agent passes"
   feed on the Today page from day one?
