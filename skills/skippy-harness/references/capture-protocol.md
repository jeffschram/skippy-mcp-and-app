# Skippy Harness Capture Protocol

Use this protocol for Codex, Claude, Hermes, ChatGPT, and any agent harness connected to Skippy MCP. The goal is durable, useful, source-backed memory without surprising the user or archiving raw private material.

## Capture Paths

### Direct Capture

Use direct accepted writes when the item is low-risk, useful later, and either explicitly requested or strongly evidenced.

Examples:

- The user says "remember this", "capture this", "create a project", "add a task", or "record the decision".
- A source contains a clear bill, deadline, meeting commitment, follow-up, or project-relevant fact.
- The user states an architecture decision or operating principle in the current conversation.
- A known project receives a clear new task, link, person, or decision.

Preferred tools:

- `ingest_object` for source-backed typed objects.
- `capture` for explicit free-form notes.
- `create_project` or `create_task` only for explicit user commands.
- Future typed tools such as `record_decision`, `record_principle`, and `record_memory` when available.

### Ask First

Ask before storing when retention may surprise the user or the memory is sensitive/high-impact.

Ask first for:

- Health, legal, financial details beyond simple tasks, family/relationship context, identity details, exact addresses, or private third-party facts.
- Negative judgments about people or companies.
- Major new projects inferred from weak signals.
- Priority changes, strategic commitments, or commitments made on behalf of the user.
- Raw or detailed private conversation content.

Use a short confirmation:

> "This seems worth remembering, but it includes sensitive personal context. Should I store a sanitized note like: `[short wording]`?"

If the user declines, do not store it. If there is a non-sensitive task, store only that task.

### Review Candidate

Use Review when the item may matter but should not be silently accepted.

Send to Review for:

- Ambiguous commitments.
- Possible duplicates or conflicts.
- Weakly inferred projects, people, or principles.
- Items that need classification or merge decisions.
- Uncertain source-derived memories that are useful enough to inspect later.

Preferred tool: `submit_candidate_object`.

### Ignore

Do not write anything for:

- Marketing, newsletters, routine shipping notices, generic confirmations, and stale alerts.
- Raw source dumps with no distilled future-use value.
- Secrets, credentials, auth tokens, private keys, card numbers, or full account numbers.
- Speculation that cannot be labeled as uncertain.

## Source References

Include `sourceRefs` for anything derived from a source or another inspected system. Keep them lightweight:

- `sourceSystem`: `gmail`, `calendar`, `imessage`, `apple_reminders`, `codex`, `claude`, `hermes`, `chatgpt`, `manual_conversation`, or another clear name.
- IDs when available: `externalId`, `threadId`, `messageId`, `eventId`, `reminderId`.
- `sourceTimestamp` when the source happened or was received.
- `participants` only when relevant to future context.
- `url` or `deepLink` when available.
- `summary`: one short sentence.
- `excerpt`: the shortest useful quote or snippet, not a raw dump.

Do not include secrets or long private bodies in source refs.

## Explain Actions

After a write or review submission, tell the user:

- What happened: stored, asked, sent to Review, skipped, or retrieved.
- Entity type and title.
- Why: rubric signal or consent reason.
- Where: Skippy URL returned by the tool, if available.

Examples:

- "Stored `Keep ingestion rubric-first` as a Skippy decision because you stated it as the architecture direction for this rollout."
- "Sent `Possible vendor renewal` to Skippy Review because the email hints at a commitment, but the owner/date is unclear."
- "I skipped the newsletter because it had no deadline, relationship signal, decision, or reusable project context."
- "Before editing, I checked Skippy for the rollout context and found the current decision to keep Review as the uncertainty fallback."

## Retrieval Before Work

Before doing contextful work, retrieve Skippy context when the user mentions:

- A known project, person, company, task, source, or long-running area.
- "What should I focus on", "where did we leave off", "use my memory", or similar.
- Work that may depend on prior decisions or principles.

Current tools:

- `ask`: query specific project, decision, person, or memory context.
- `summarize_focus`: retrieve focus context.
- `get_importance_rubric`: retrieve capture policy before ingestion.

Future tools:

- `get_context_bundle`
- `search_memory`
- `get_project_brief`
- `get_person_context`

Use the context; do not recite it all. Mention only context that changes the work.

## Examples

### New Project Detection

User says: "We need to roll out Skippy as my second brain across Codex and Hermes."

If explicit: create or ingest a project.

```json
{
  "candidateEntityType": "project",
  "candidatePayload": {
    "title": "Skippy second-brain rollout",
    "summary": "Roll out Skippy as a durable memory layer across agent harnesses.",
    "status": "active",
    "priorityReason": "User described it as a cross-harness product direction."
  },
  "rubricDecision": "Active project direction with durable context for future agent work.",
  "sourceRefs": [
    {
      "sourceSystem": "codex",
      "summary": "User initiated Skippy second-brain rollout work.",
      "excerpt": "roll out Skippy as my second brain"
    }
  ]
}
```

If inferred from passing discussion: ask "Should I create a Skippy project for this rollout?" or submit a review candidate.

### Decision Capture

User says: "Let's keep source ingestion rubric-first and use Review only when uncertain."

Directly capture:

```json
{
  "candidateEntityType": "knowledgeObject",
  "candidatePayload": {
    "objectType": "decision",
    "title": "Keep Skippy ingestion rubric-first",
    "summary": "Source ingestion should write accepted objects directly when the rubric decision is clear; Review is only for uncertainty.",
    "properties": {
      "decision": "Use rubric-first direct ingestion with Review as the uncertainty fallback.",
      "rationale": "Keeps useful memory flowing while preserving user control for ambiguous items."
    }
  },
  "rubricDecision": "Explicit architecture decision that future harnesses and implementers must follow.",
  "sourceRefs": [
    {
      "sourceSystem": "codex",
      "summary": "User chose the ingestion architecture.",
      "excerpt": "rubric-first and use Review only when uncertain"
    }
  ]
}
```

### Principle Capture

User says: "Skippy should store summaries with provenance, not raw private dumps."

Directly capture as a principle:

```json
{
  "candidateEntityType": "knowledgeObject",
  "candidatePayload": {
    "objectType": "principle",
    "title": "Store distilled memory, not raw private dumps",
    "summary": "Skippy should retain concise summaries with source refs instead of full private source bodies.",
    "properties": {
      "scope": "harness ingestion and second-brain memory",
      "strength": "hard_rule"
    }
  },
  "rubricDecision": "Explicit privacy principle that governs future captures.",
  "sourceRefs": [
    {
      "sourceSystem": "codex",
      "summary": "User stated a durable privacy rule for Skippy memory.",
      "excerpt": "summaries with provenance, not raw private dumps"
    }
  ]
}
```

### Sensitive Memory Requiring Confirmation

Source implies: the user has a private health, legal, family, or financial situation.

Do not store directly. Ask:

"This may be useful later, but it is sensitive. Should I store a sanitized Skippy memory that says `[short neutral summary]`, or skip retaining it?"

If confirmed, store only the sanitized version with the consent path noted. If declined, skip it.

### Interview Initiation

If a new or active project lacks purpose, success criteria, stakeholders, risks, or next action, ask:

"Want to do a project interview for `[assistantDisplayName]`?"

Use `list_interview_templates` first when you need the saved assistant name and available interview types. Then use `start_interview` and conduct the interview in the harness chat, one question at a time. The web app interview pages are the management/history view, not the only place interviews can happen.

Start example:

```json
{
  "kind": "project",
  "subjectLabel": "Skippy MCP and APP",
  "startedBy": "codex"
}
```

When the user answers, call `answer_interview_question`. Leave `createMemoryCandidate` false unless the user explicitly wants that answer sent to Memory Inbox.

When all questions are answered, ask whether to complete the interview and whether to submit a distilled summary to Memory Inbox. If the user cancels or it was only a test, call `archive_interview`.

### Context Retrieval Before Work

User says: "Update the Skippy harness docs."

Before editing:

1. Call `ask` for "Skippy harness protocol decisions and second-brain rollout context".
2. Call `get_importance_rubric` if you may capture new decisions.
3. Use only relevant returned context.

User-facing explanation:

"I checked Skippy context first and found the standing rule: accepted ingestion should be rubric-first, with Review only for uncertain signals. I used that as the basis for the docs update."
