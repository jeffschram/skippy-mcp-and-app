# Skippy Second-Brain Dev Spec

This spec turns the second-brain proposal into buildable work. It is scoped to Skippy as a durable memory, project, and agent-context layer used by Codex, Claude, Hermes, ChatGPT, and future MCP harnesses.

## Product Goal

Skippy should store the user's important context as concise, source-backed knowledge that can be retrieved before future work. It should remember projects, tasks, decisions, principles, questions, people, relationships, sources, and open loops without becoming a raw transcript archive.

## Core Milestones

### M0: Harness Protocol

- Publish direct-capture, ask-first, review-candidate, ignore, and retrieval-before-work rules.
- Require concise source refs on source-derived writes.
- Require user-facing explanations after any write or review submission.
- Add examples for project detection, decisions, principles, sensitive memories, interviews, and context retrieval.

### M1: Memory Data Model

- Add typed memory objects for `decision`, `principle`, `question`, `insight`, and `memory`.
- Continue using `note`, `task`, `project`, `person`, `company`, `link`, and generic `knowledgeObject`.
- Store status, confidence, sensitivity, source refs, created-by actor, and review state.
- Support relationships between memory objects and projects, people, companies, tasks, and sources.

### M2: Capture APIs and MCP Tools

- Keep current tools: `capture`, `ingest_object`, `submit_candidate_object`, `get_importance_rubric`, `ask`, `summarize_focus`, `create_project`, `create_task`, `link_entities`, `add_source_ref`, and pending-action tools.
- Add typed tools as the data model lands:
  - `record_decision`
  - `record_principle`
  - `record_memory`
  - `record_question`
  - `start_memory_interview`
  - `get_context_bundle`
  - `search_memory`
  - `get_project_brief`
  - `get_person_context`
- Preserve `ingest_object` as the generic MCP fallback so older harnesses can write new types through `knowledgeObject`.

### M3: Review and Consent UX

- Rename legacy triage surfaces to Review/Memory Inbox language.
- Show uncertain captures, sensitive capture requests, possible duplicates, and inferred major project changes.
- Provide approve, reject, edit, merge, reclassify, and "always handle similar items this way" actions.
- Log the final review decision as training signal for future rubric decisions.

### M4: Retrieval Surfaces

- Add Library pages for decisions, principles, questions, and memories.
- Add project and person briefs that show linked decisions, open questions, active tasks, recent source refs, and relevant principles.
- Add context bundles that can be returned through MCP before work begins.
- Require cited source refs or entity links in generated answers when available.

### M5: Interviews and Reviews

- Add guided interviews for new projects, goals, decisions, people, and weekly review.
- Interviews should write accepted objects only for explicit answers; inferred items can go to Review.
- Use interviews to fill missing project purpose, success criteria, stakeholders, risks, next actions, and decision rationale.

### M6: Rollout and Safety

- Ship to one brain instance first with verbose activity logging.
- Enable direct capture only for low-risk categories at first.
- Keep sensitive inferred memory behind confirmation until the user changes the policy.
- Add smoke tests for MCP write paths and retrieval-before-work examples.
- Add export/delete support before broad rollout.

## Data Model

Recommended shared fields for second-brain records:

```ts
type MemoryKind =
  | "decision"
  | "principle"
  | "question"
  | "insight"
  | "memory"
  | "note";

type ConsentMode = "direct" | "asked_first" | "review_candidate" | "explicit_user_request";

type Sensitivity = "low" | "medium" | "high";
```

```ts
memoryObjects {
  brainInstanceId: Id<"brainInstances">,
  kind: MemoryKind,
  title?: string,
  body: string,
  summary?: string,
  status: "active" | "archived" | "superseded" | "rejected",
  confidence?: number,
  sensitivity: Sensitivity,
  consentMode: ConsentMode,
  captureReason: string,
  createdBy: "user" | "harness" | "skippy_ai" | "system",
  harness?: "codex" | "claude" | "hermes" | "chatgpt" | string,
  sourceRefIds?: Id<"sourceRefs">[],
  relatedEntityRefs?: EntityRef[],
  supersedesId?: Id<"memoryObjects">,
  createdAt: number,
  updatedAt: number
}
```

Decision-specific properties:

- `decision`: what was decided.
- `rationale`: why.
- `alternatives`: rejected options.
- `decidedAt`: when.
- `revisitAt`: optional review date.

Principle-specific properties:

- `principle`: the reusable rule or preference.
- `scope`: where it applies.
- `strength`: `preference`, `default`, or `hard_rule`.
- `exceptions`: optional caveats.

Question-specific properties:

- `question`: open inquiry.
- `status`: `open`, `answered`, `parked`, or `dropped`.
- `nextReviewAt`: optional revisit date.

Source refs stay lightweight. Do not store raw private transcripts when a summary and short excerpt are enough.

## API Behavior

### Capture Path

1. Harness retrieves the current importance rubric for source-derived work.
2. Harness classifies the candidate as direct capture, ask-first, review candidate, or ignore.
3. Harness calls the narrowest MCP tool.
4. Skippy validates, normalizes, dedupes, stores source refs, links related entities, and logs activity.
5. Harness tells the user what happened and why.

### Retrieval Path

1. Before contextful work, harness asks Skippy for relevant project/person/task/memory context.
2. Skippy returns concise context with entity IDs, source refs, timestamps, and confidence.
3. Harness uses the context in its answer or work plan and cites Skippy context when it materially changes behavior.

### Consent Rules

Direct capture is allowed for:

- Explicit user requests to remember, capture, create, or record.
- Low-risk source-derived tasks with clear deadlines or commitments.
- Low-risk decisions or principles stated by the user in the current conversation.
- Factual project context with clear evidence.

Ask first for:

- Sensitive personal facts, health, legal, financial details, family/relationship context, identity details, exact addresses, or anything the user may not expect to be retained.
- Major new projects inferred from weak signals.
- Priority changes, commitments on behalf of the user, or negative judgments about people.
- Raw or detailed third-party private content.

Submit review candidates for:

- Useful but ambiguous signals.
- Possible duplicates or conflicts with existing memory.
- Items that may be important but lack enough evidence.
- Inferred memories that are not sensitive enough to interrupt the user.

Never store:

- Secrets, credentials, auth tokens, private keys, payment card numbers, or unredacted account numbers.
- Full raw emails, messages, calendar bodies, or interviews unless the user explicitly requests archival.
- Speculation presented as fact.

## UI Pages

- Home: focus summary, urgent tasks, pending reviews, pending actions, recent memory.
- Projects: active initiatives, tasks, linked decisions, linked principles, project brief.
- Library: decisions, principles, questions, insights, notes, memories, links.
- Review: uncertain candidates, sensitive confirmation requests, duplicate/merge prompts.
- Interviews: guided project, goal, people, decision, and weekly review sessions.
- Sources: source refs, ingestion logs, connector status, recent harness activity.
- Settings: importance rubric, autonomy policy, notification preferences, MCP tokens.

## MCP Tool Notes

- `ingest_object`: primary accepted write for source-backed objects with `rubricDecision` and `sourceRefs`.
- `capture`: explicit free-form user capture or concise note when no typed entity fits.
- `submit_candidate_object`: uncertainty fallback; visible in Review.
- `get_importance_rubric`: read before nontrivial ingestion.
- `ask` / `summarize_focus`: current retrieval tools.
- Future `get_context_bundle`: preferred retrieval tool once implemented.
- Future typed memory tools should return chat-friendly confirmation fields, entity IDs, review URLs, and source-ref counts.

## Practical Examples

### New Project Detection

Signal: the user says, "We need to roll out Skippy as my second brain across Codex and Hermes."

- Direct capture if the user asks to create the project.
- Ask first if inferred from passing discussion.
- Store title, purpose, likely stakeholders, source ref to the conversation, and an interview prompt to gather success criteria.

### Decision Capture

Signal: "Let's keep source ingestion rubric-first and use Review only when uncertain."

- Directly record a decision because it is explicit, low-risk, and architecture-relevant.
- Include rationale and rejected alternative if stated.
- Link to the Skippy project and source conversation.

### Principle Capture

Signal: "Skippy should store summaries with provenance, not raw private dumps."

- Directly record as a principle.
- Scope it to harness ingestion and privacy.
- Mark strength as `hard_rule` if the user phrases it as non-negotiable.

### Sensitive Memory

Signal: a message implies a health, financial, legal, family, or private relationship fact.

- Ask before storing.
- Offer a short sanitized wording.
- If the user declines, do not store it; optionally store only a non-sensitive task if one exists.

### Interview Initiation

Signal: a new project exists but lacks purpose, success criteria, owner, or next action.

- Ask whether to start a short project interview now.
- Future tool: `start_memory_interview({ type: "project", entityId })`.
- Current fallback: create a review candidate or task such as "Fill in Skippy second-brain rollout project brief."

### Context Retrieval Before Work

Signal: the user asks an agent to work on Skippy docs, product direction, or code.

- Call `ask` or future `get_context_bundle` for the relevant project and recent decisions.
- Retrieve the importance rubric if capture may happen.
- Summarize only the context used, then proceed.

## Rollout Checklist

- Harness instructions published and packaged.
- Existing MCP tools documented with examples.
- Review page handles candidates from all harnesses.
- Activity logs show actor, consent mode, source refs, and capture reason.
- Smoke tests cover direct capture, review candidate, ask-first prompt wording, source refs, and retrieval.
- User can correct or delete captured memory.
