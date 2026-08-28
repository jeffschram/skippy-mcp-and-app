# Token efficiency plan

**Status:** reviewed — all §4 decisions settled 2026-08-28; ready to become
plan tasks. The `[1m]` host-config change is already applied.
**Problem:** working sessions in the Skippy project burn through the Claude
subscription's rolling usage window in roughly an hour ("You've hit your
limit"). Every chat turn, task run, and (soon) scheduled agent pass in Phase 6
draws from the same window, so efficiency is now a real capacity constraint,
not a nicety.

---

## 1. Diagnosis — where the tokens actually go

Grounded in the current code, not guesswork:

### a. Every session pays the full Skippy MCP tool schema (~25–40k tokens)

`ClaudeAdapter` injects the Skippy MCP into **every** session with a
full-access token (`apps/runner/src/harness/claude.ts` → `mcpServers.skippy`).
The server therefore serves all ~60 tools, and many descriptions are
essay-length (the finance taxonomy alone is ~600 words; the memory rubric,
file-upload protocol, and recurrence docs are similar). That schema text is
context in every session: every chat turn thread, every task run, every future
scheduled agent pass — even a session that only ever calls `get_project_plan`.

Prompt caching softens repeat turns *within* a session, but each **new**
session (new chat, new task run, each agenda pass) pays the write again.

### b. No model tiering — everything runs on the host default

The adapter never sets a `model` option, so every session uses the Claude Code
host default. On a Max plan, Opus consumes the usage window ~5x faster than
Sonnet. If the default is Opus (or "opusplan"), casual chat turns — "update
main locally" — cost Opus rates. This is very likely the single biggest lever
on the subscription window.

### c. We measure nothing

Both adapters emit `usage` events with real per-turn token counts
(`claude.ts:381`, `codex.ts:207`) — and both executors discard them:
`chatExecutor`'s `LIVE_EVENT_TYPES` filters them out, and `RunExecutor` never
persists them. There is currently no way to answer "which session type eats
the window?"

### d. Long single chats + full-history replay

Chat turns resume harness sessions (`options.resume`) — good, cached. But a
fresh thread replays the **entire chat history as prose** in the prompt
(`buildChatPrompt`), uncapped. Our working style — one marathon chat covering
a whole day of design + implementation — grows a session context that every
subsequent turn drags along. A resumed session that dies (restart, limit) gets
rebuilt from full history at full price.

### e. Verbose command output lands in context

Verification runs full vitest/typecheck output (985 tests across workspaces)
into the session transcript. Exploration reads of whole large files do the
same. Each of those lines is context for the rest of the session.

### f. No CLAUDE.md — sessions re-explore the repo every time

There is no repo-root `CLAUDE.md`, so every fresh session re-derives the
monorepo layout, conventions, and verify commands by reading files —
hundreds-to-thousands of tokens of rediscovery per session, plus wrong-first-
guess commands.

### g. Task runs are the most expensive session shape

The run prompt itself is lean (`buildPrompt`: brief + acceptance criteria),
but everything around it is a cold start:

- **Fresh session + fresh worktree per run** — full MCP schema (a), full repo
  re-exploration (f), every time. A retried task (`attempt: N+1`) pays the
  entire bootstrap again with no memory of attempt N.
- **In-session verification** — the session runs typecheck/tests itself and
  the full reporter output lands in its context, often multiple times per run
  (before and after fixes). The runner's *own* scripted verify step
  (`outputTail`-capped) is free; the in-session ones are not.
- **Worst tool-surface ratio** — a task run needs roughly a dozen Skippy
  tools (`get_task_brief`, `mark_task_in_progress`, `record_task_result`,
  project-file tools) but receives all ~60. A `task`-role scoped token cuts
  deeper here than anywhere else.
- **Brief quality is a token lever** — a brief that names concrete files and
  the exact filtered verify command shrinks exploration directly. (The PM
  Agent's brief-writing role is, incidentally, a token-efficiency feature.)

By contrast, worktree provisioning and post-merge close-outs are scripted —
zero tokens. The expensive part is purely the harness session.

### h. Phase 6 multiplies session count

An agenda agent at a 30-minute cadence is ~30 sessions/day, each paying (a)
in full. Cadence, per-agent model choice, and scoped tool surface decide
whether the agent runtime is cheap or a window-killer.

---

## 2. Levers, prioritized

| # | Lever | Impact | Effort | Notes |
|---|---|---|---|---|
| 1 | **Measure: persist usage events** | enabler | S | Store per-turn/per-run token counts on `chatTurns` / `agentRuns`; surface totals in the Agents hub or Logs. Everything else gets validated by this. |
| 2 | **Model tiering** | ★★★ | S | Add `model` to harness options + runner config. **Decided defaults:** interactive chat stays **Opus-class** (owner preference — but drop the premium `[1m]` long-context variant found in the host config), **Sonnet/Haiku for scheduled agents** (unattended, structured work), and a **per-project default model for task runs** (a project setting, like the default base branch). Tiering targets unattended sessions, not the owner's chats. |
| 3 | **Slim the MCP tool surface** | ★★★ | M | Two halves: (i) **use the role-scoped tokens we just built** — scheduled agents get `agenda`/`finance`/`pm` tokens, and **task runs get a `task` scope** (~12 tools instead of ~60 — the deepest single cut, see §1g); (ii) **audit the tool description text itself** — we own the MCP server; move essays into skills (which are loaded only when relevant) and keep descriptions to 1–3 sentences. Also consider a trimmed "chat" scope for everyday chat turns. |
| 4 | **Context hygiene in chat** | ★★ | S–M | Cap replayed history in `buildChatPrompt` (last N messages + a stored summary of the rest). Product-side nudge: chats-per-topic instead of marathon chats — cheap to encourage in UI copy. |
| 5 | **CLAUDE.md** | ★★ | S | Repo map, package layout, canonical verify commands (`pnpm typecheck`, filtered test commands), conventions. Paid once per session instead of re-explored. |
| 6 | **Output discipline** | ★ | S | Quiet reporters for verification (`vitest --reporter=dot`), `--filter` scoping to touched packages, head/tail conventions baked into skills and task briefs. |
| 6b | **Sharper task briefs** | ★★ | S | Briefing conventions (in the PM Agent skill + `brief_task` guidance): name the concrete files, the exact filtered verify command, and known patterns to copy — every named fact is exploration the run session skips. |
| 7 | **Scheduled-agent budgets** | ★★ (future) | S | **Decided: agenda cadence 60 min** (was seeded at 30); early-exit when nothing new (skill already says "stop quietly"); per-agent model in `agentConfigs` (the schema was designed to grow this). |
| 8 | **Overflow fallback: Codex harness** | fallback | — | **Decided: no metered API key.** If the Claude window still pinches after the levers land, the owner switches sessions to the Codex harness (already wired in the runner, bills against the separate ChatGPT subscription quota). Nothing to build. |

**Not proposed:** dropping session resume (it's the thing that makes long
chats cheap-ish), or reducing verification coverage (quiet ≠ skipped).

---

## 3. Proposed rollout

**Stage 1 — see clearly (one small PR)**
1. Persist `usage` events from both adapters onto `chatTurns` and `agentRuns`.
2. Show cumulative tokens per chat / per run / per day in the UI (Logs or
   Agents hub).
3. Add `CLAUDE.md` (pure win, no risk).

**Stage 2 — the big levers (one PR each)**
4. Model tiering: runner config + per-project task-run default, per §2.2.
5. MCP description audit: measure schema size before/after (target: −50%),
   move long guidance into skills.
6. `task`-scoped token for run sessions (runner config swap — the role
   allowlist machinery already exists).
7. History cap + summary in `buildChatPrompt`.

**Stage 3 — Phase 6 integration**
8. Scheduled agents launch with scoped tokens + per-agent model from day one,
   agenda at 60 min (folds into the existing agent-heartbeat task, not new
   work).
9. Revisit with a week of usage data; overflow fallback is the Codex harness
   (separate quota), not an API key.

---

## 4. Decisions — all settled (owner, 2026-08-28)

1. **Default model for chat turns**: **Opus-class stays** (owner prefers it
   for interactive work). Host default was `claude-fable-5[1m]`; the `[1m]`
   premium long-context variant has been **dropped (done)** — model tier
   unchanged. Consequence: the per-token levers (#3, #5, #6) and cheap-model
   scheduled agents carry the savings.
2. **Task-run model**: **per-project default** (a project setting), not a
   per-run picker.
3. **Marathon chats**: **history cap + summary approved** (accepting fuzzier
   recall of very old turns within a single chat).
4. **Agenda cadence**: **60 minutes** (update the seeded 30-min default).
5. **Escape valve**: **no metered API key.** If limits still pinch, the owner
   switches work to the Codex harness (separate ChatGPT quota) — already
   supported by the runner, nothing to build.
