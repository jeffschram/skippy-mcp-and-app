---
name: skippy-harness
description: Use when an AI harness connected to Skippy MCP needs to decide what source or conversation content should be sent to Skippy, which Skippy MCP tool to call, how to structure candidate objects and source references, how to avoid privacy-heavy raw dumps, and how to explain Skippy actions back to the user.
---

# Skippy Harness

Use Skippy as the user's canonical second-brain store. The harness supplies context and connector access; Skippy stores reviewed knowledge, provenance, tasks, relationships, focus summaries, and pending action state.

## Decision Loop

1. Classify the user's intent.
   - Explicit create/update request: use direct accepted tools only when the user clearly asks to create a Skippy project/task or mark a task done.
   - Source-derived or inferred knowledge: submit candidates to triage.
   - Read/question request: use read-only tools such as `ask`, `summarize_focus`, or `list_pending_actions`.
   - External side effect: create or inspect pending action state; do not send emails/messages or alter external systems through Skippy.

2. Filter for usefulness before writing.
   Submit items that are actionable, deadline-bearing, relationship-building, decision-relevant, financially or logistically important, user-preference-like, or clearly useful future context. Ignore routine notifications, marketing, duplicate receipts, generic confirmations, stale noise, and raw source content with no clear future use.

3. Choose the narrowest tool.
   - `create_project` / `create_task`: only for explicit user commands.
   - `submit_candidate_object`: preferred for structured source-derived objects.
   - `upsert_task`, `upsert_person`, etc.: convenience candidate tools; still triage-first.
   - `capture`: only for useful free-form notes when a typed entity is not clear.
   - `link_entities`: only after accepted entity IDs are known.
   - `mark_task_done`: only when the user says the Skippy task is complete.

4. Include provenance.
   Add `sourceRefs` whenever content came from email, calendar, reminders, messages, links, files, or another inspected source. Include IDs, timestamps, participants, URLs/deep links, short excerpts, and concise summaries when available.

5. Keep payloads reviewable.
   Prefer concise fields over long transcripts. Do not store full raw emails, full calendar descriptions, secrets, auth tokens, payment numbers, medical/legal detail, or private content unrelated to the extracted object.

6. Confirm in chat.
   Tell the user what was submitted or created, the entity type/title, whether it is awaiting triage or already accepted, and the Skippy review URL returned by the MCP tool. Mention important uncertainty.

## Entity Mapping

Use schema-friendly fields. For detailed mapping examples, read `references/entity-mapping.md` when preparing structured candidates from source data.

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

- "Submitted `Pay Optimum bill` as a task candidate for Skippy triage: http://127.0.0.1:3000/triage"
- "Created the accepted task `Improve MCP chat confirmations` in Skippy: http://127.0.0.1:3000/projects"
- "I skipped the newsletter because it did not contain a deadline, decision, relationship, or reusable context."

Do not imply source-derived items are accepted knowledge until Skippy reports a direct create/update or the user approves triage.
