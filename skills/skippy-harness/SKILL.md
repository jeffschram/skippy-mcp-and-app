---
name: skippy-harness
description: Use when an AI harness connected to Skippy MCP needs to decide what source or conversation content clears the user's importance rubric, which Skippy MCP tool to call, how to structure accepted objects and source references, how to avoid privacy-heavy raw dumps, and how to explain Skippy actions back to the user.
---

# Skippy Harness

Use Skippy as the user's canonical second-brain store. The harness supplies context and connector access; Skippy stores accepted knowledge, provenance, tasks, relationships, focus summaries, operating rules, and pending action state.

Before capture or retrieval work that may create durable memory, read `references/capture-protocol.md`. For structured payload fields, read `references/entity-mapping.md`.

## Decision Loop

1. Classify the user's intent.
   - Explicit create/update request: use direct accepted tools only when the user clearly asks to create a Skippy project/task or mark a task done.
   - Source-derived or inferred knowledge: read/apply the importance rubric, then ingest only items that clearly clear the bar.
   - Read/question request: use read-only tools such as `ask`, `summarize_focus`, or `list_pending_actions`.
   - External side effect: create or inspect pending action state; do not send emails/messages or alter external systems through Skippy.

2. Retrieve relevant context before contextful work.
   If the user asks you to work on a known Skippy project, person, task, source, or recurring area, call `ask`, `summarize_focus`, or the future `get_context_bundle` before acting. Use the retrieved context to avoid stale decisions and to link new captures to existing entities.

3. Filter for usefulness before writing.
   Submit items that are actionable, deadline-bearing, relationship-building, decision-relevant, financially or logistically important, user-preference-like, or clearly useful future context. Ignore routine notifications, marketing, duplicate receipts, generic confirmations, stale noise, and raw source content with no clear future use.

4. Choose the narrowest tool.
   - `get_importance_rubric`: use before nontrivial source ingestion so the decision follows the user's current rules.
   - `update_source_sync_status`: for batch or scheduled ingestion, set `status: "running"` before reading sources, send heartbeat updates during long runs, and set `status: "completed"` or `"failed"` before ending so the Skippy Home NOW area reflects live updates.
   - `ingest_object`: primary source-ingestion tool when an item clears the rubric; include `rubricDecision`.
   - Link routing: links are reference material, not a reading queue — the user is never required to interact with them. Confident, rubric-clearing links go straight through `ingest_object` (status defaults to `saved`; no user interaction expected). Pass `status: "unread"` only when the user explicitly wants to read the link later. If you are genuinely uncertain whether a link is valid or important, use `submit_candidate_object` so it lands in Review for a one-tap decision.
   - `create_project` / `create_task`: only for explicit user commands.
   - `upsert_task`, `upsert_person`, etc.: convenience accepted-object tools when the item clearly clears the rubric but no source refs or custom decision are needed.
   - `submit_candidate_object`: review fallback when an item seems useful but is ambiguous, potentially duplicate, weakly inferred, or not safe to accept silently.
   - `capture`: only for useful free-form notes when a typed entity is not clear.
   - `list_interview_templates` / `start_interview` / `get_interview` / `answer_interview_question` / `complete_interview`: run guided second-brain interviews inside the harness chat. Use the returned `assistantDisplayName` when offering the interview.
   - `link_entities`: only after accepted entity IDs are known.
   - `get_current_context`: resolve what the user has open in the web app. Call this when the user says "this project", "here", or "add a task to this project" without naming it; use the returned active project's id.
   - `plan_project`: decompose an accepted project into executable tasks. Requires an LLM provider on the brain.
   - `brief_task`: write a repo-grounded execution brief plus acceptance criteria for a Proposed task and move it to Briefed.
   - `list_ready_tasks` / `get_task_brief`: find the next unblocked task and fetch its hand-off brief to execute.
   - `record_task_result`: report an executed task's outcome (summary + PR/commit URL) for owner review.
   - `mark_task_done`: only when the user says the Skippy task is complete.

5. Apply the consent model.
   - Direct capture: explicit user requests, low-risk source-backed commitments, deadlines, decisions, principles, and project facts with clear evidence.
   - Ask first: sensitive personal context, health/legal/financial/family/relationship details, exact addresses, negative judgments about people, major inferred projects, priority changes, or anything the user may not expect to be retained.
   - Review candidate: useful but uncertain, possible duplicate/conflict, weakly inferred, or needs user classification.
   - Ignore: noise, marketing, routine confirmations, stale source data, raw dumps, and anything with no future-use signal.

6. Include provenance.
   Add `sourceRefs` whenever content came from email, calendar, reminders, messages, links, files, or another inspected source. Include IDs, timestamps, participants, URLs/deep links, short excerpts, and concise summaries when available.

7. Keep payloads reviewable.
   Prefer concise fields over long transcripts. Do not store full raw emails, full calendar descriptions, secrets, auth tokens, payment numbers, medical/legal detail, or private content unrelated to the extracted object.

8. Confirm in chat.
   Tell the user what was stored, skipped, asked, or sent to Review; include the entity type/title, consent path, rubric decision or capture reason, and the Skippy URL returned by the MCP tool. If you retrieved context first, mention only the context that mattered.

9. Close batch status.
   If you started a source sync status, always close it with `update_source_sync_status` even when some connectors fail. Use `failed` only when the whole run cannot finish; otherwise use `completed` with short source error summaries.

## Plan → Execute Loop

Skippy is a supervised software-project dashboard: **Skippy plans, a coding agent executes.** Skippy never writes code itself.

1. `plan_project` decomposes an accepted project into ordered tasks, each with an execution brief, acceptance criteria, and `depends_on` links. The owning project moves to `in_progress`.
2. `brief_task` moves a Proposed task to Briefed: list the proposed tasks, write an execution brief grounded in the actual repo (approach, key files, verification steps), then call `brief_task` with the brief and acceptance criteria. Briefed tasks wait for the owner to promote them to Ready.
3. `list_ready_tasks` returns agent-owned tasks whose dependencies are all done (execution state `ready`) — the next work to pick up.
4. `get_task_brief` returns one task's self-contained brief. Execute it (write code, open a PR) outside Skippy.
5. `record_task_result` reports the outcome. By default the task moves to `in_review` for the owner to approve; pass `markDone: true` to complete it, which unblocks dependent tasks.

Keep the human in the loop: surface the plan and each result for review instead of silently completing work. If the brain has no LLM provider, `plan_project` fails — tell the user to configure one in Settings.

### Resolving "this project"

When the user refers to a project without naming it ("add a task to this project", "plan this", "here"), call `get_current_context` to get the active project the user has open in the web app, then use its id with `create_task`, `plan_project`, etc.

### Code projects (GitHub repo + local folder)

A project may be a **code project** with an associated GitHub repo URL and a local folder path (set in the web app's project Settings; surfaced in `get_current_context` and task briefs). For an agent-owned task on a code project, follow this execution loop:

1. Create a new local branch in the project's local repo.
2. Do the work in that branch.
3. Commit and open a PR to the repo.
4. Call `record_task_result` with the PR URL as `resultUrl` (and a short summary). This moves the task to `in_review`. **Do not** pass `markDone` — the user completes it.
5. When the user approves/merges the PR, the task is marked done (`mark_task_done` or recording the result with `markDone: true`), which unblocks dependent tasks.

Non-code projects use a local folder only for output files/assets; the same result-recording flow applies without a PR.

## Entity Mapping

Use schema-friendly fields. For detailed mapping examples, read `references/entity-mapping.md` when preparing structured accepted objects from source data.

Good task payload:

```json
{
  "title": "Pay Optimum bill",
  "status": "todo",
  "dueDate": "2026-06-10",
  "sourceSummary": "Email says the bill is ready.",
  "priorityReason": "Financial deadline."
}
```

Good person payload:

```json
{
  "name": "Pat Example",
  "email": "pat@example.com",
  "relationshipContext": "Client contact mentioned in the renewal thread."
}
```

## Chat Language

Use plain confirmations:

- "Stored `Pay Optimum bill` as an accepted Skippy task because it has a financial deadline: http://127.0.0.1:3000/projects"
- "Created the accepted task `Improve MCP chat confirmations` in Skippy: http://127.0.0.1:3000/projects"
- "Sent `Ambiguous renewal note` to Skippy Review because the source hinted at a possible commitment, but the rubric decision was unclear: http://127.0.0.1:3000/triage"
- "Want to do a project interview for Skippy?"
- "I skipped the newsletter because it did not contain a deadline, decision, relationship, or reusable context."

Do not store source-derived items just because they exist. Store them only when the rubric decision is clear, or use the review fallback when the uncertainty itself is worth surfacing.
