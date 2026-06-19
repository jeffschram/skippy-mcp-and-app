---
name: skippy-harness
description: Use when an AI harness connected to Skippy MCP needs to decide what source or conversation content clears the user's importance rubric, which Skippy MCP tool to call, how to structure accepted objects and source references, how to avoid privacy-heavy raw dumps, and how to explain Skippy actions back to the user.
---

# Skippy Harness

Use Skippy as the user's canonical second-brain store. The harness supplies context and connector access; Skippy stores accepted knowledge, provenance, tasks, relationships, focus summaries, operating rules, and pending action state.

## Decision Loop

1. Classify the user's intent.
   - Explicit create/update request: use direct accepted tools only when the user clearly asks to create a Skippy project/task or mark a task done.
   - Source-derived or inferred knowledge: read/apply the importance rubric, then ingest only items that clearly clear the bar.
   - Read/question request: use read-only tools such as `ask`, `summarize_focus`, or `list_pending_actions`.
   - External side effect: create or inspect pending action state; do not send emails/messages or alter external systems through Skippy.

2. Filter for usefulness before writing.
   Submit items that are actionable, deadline-bearing, relationship-building, decision-relevant, financially or logistically important, user-preference-like, or clearly useful future context. Ignore routine notifications, marketing, duplicate receipts, generic confirmations, stale noise, and raw source content with no clear future use.

3. Choose the narrowest tool.
   - `get_importance_rubric`: use before nontrivial source ingestion so the decision follows the user's current rules.
   - `update_source_sync_status`: for batch or scheduled ingestion, set `status: "running"` before reading sources, send heartbeat updates during long runs, and set `status: "completed"` or `"failed"` before ending so the Skippy Home NOW area reflects live updates.
   - `ingest_object`: primary source-ingestion tool when an item clears the rubric; include `rubricDecision`.
   - `create_project` / `create_task`: only for explicit user commands.
   - `upsert_task`, `upsert_person`, etc.: convenience accepted-object tools when the item clearly clears the rubric but no source refs or custom decision are needed.
   - `submit_candidate_object`: legacy uncertainty fallback when you cannot decide whether the item belongs in Skippy.
   - `capture`: only for useful free-form notes when a typed entity is not clear.
   - `link_entities`: only after accepted entity IDs are known.
   - `mark_task_done`: only when the user says the Skippy task is complete.

4. Include provenance.
   Add `sourceRefs` whenever content came from email, calendar, reminders, messages, links, files, or another inspected source. Include IDs, timestamps, participants, URLs/deep links, short excerpts, and concise summaries when available.

5. Keep payloads reviewable.
   Prefer concise fields over long transcripts. Do not store full raw emails, full calendar descriptions, secrets, auth tokens, payment numbers, medical/legal detail, or private content unrelated to the extracted object.

6. Confirm in chat.
   Tell the user what was stored, the entity type/title, the rubric decision, and the Skippy URL returned by the MCP tool. If you used the uncertainty fallback, say what needs review and why.

7. Close batch status.
   If you started a source sync status, always close it with `update_source_sync_status` even when some connectors fail. Use `failed` only when the whole run cannot finish; otherwise use `completed` with short source error summaries.

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
- "I skipped the newsletter because it did not contain a deadline, decision, relationship, or reusable context."

Do not store source-derived items just because they exist. Store them only when the rubric decision is clear, or use the review fallback when the uncertainty itself is worth surfacing.
