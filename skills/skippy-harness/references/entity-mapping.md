# Skippy Entity Mapping

Use these fields when calling Skippy MCP accepted-ingestion tools.

## Task

Use for action items, follow-ups, bills, reminders, deadlines, and things the user may mark done.

- Required: `title`
- Optional: `description`, `status`, `dueAt`, `dueDate`, `sourceSummary`, `priorityReason`, `priorityScore`, `urgencyScore`, `importanceScore`
- Prefer `dueDate` for natural extracted dates; Skippy normalizes it to `dueAt` on ingestion.
- Put unsupported source details such as event start/end, amount due, location, or attendees in `sourceSummary` unless they are essential.

## Project

Use for multi-step efforts, areas of work, and active initiatives.

- Required: `title`
- Optional: `summary`, `status`, `priorityReason`
- Do not create a project for a single isolated task unless the user explicitly asks.

## Note

Use for durable facts or thoughts that are useful but not actionable or entity-like.

- Required: `body`
- Optional: `title`
- Keep it concise; do not store full raw source bodies.

## Person

Use for individual contacts.

- Required: `name`
- Optional aliases accepted by Skippy: `personName`, `email`, `emails`, `phone`, `phoneNumbers`, `relationshipContext`, `relationshipLabel`, `notes`
- Use `relationshipContext` for how/why the person matters.

## Company

Use for organizations.

- Required: `name`
- Optional aliases accepted by Skippy: `companyName`, `website`, `url`, `domain`, `notes`, `relationshipLabel`
- `relationshipLabel` should be one of `client`, `vendor`, `employer`, `partner`, `prospect`, or `other`.

## Link

Use for URLs the user may want to read, save, or reference later.

- Required: `url`
- Optional: `title`, `summary`, `whyItMatters`, `status`
- Prefer harness-provided metadata; Skippy may enrich links later.

## Knowledge Object

Use for structured facts that do not fit task/project/person/company/link/note.

- Required: `title`
- Optional: `objectType`, `summary`, `properties`
- Use `properties` for small structured attributes only.

## Decision

Until Skippy exposes a dedicated `record_decision` tool, store decisions as `knowledgeObject` with `objectType: "decision"`.

- Required: `title`, `summary`
- Recommended `properties`: `decision`, `rationale`, `alternatives`, `decidedAt`, `revisitAt`
- Directly capture only when the user clearly states the decision or the source evidence is strong.

## Principle

Until Skippy exposes a dedicated `record_principle` tool, store principles as `knowledgeObject` with `objectType: "principle"`.

- Required: `title`, `summary`
- Recommended `properties`: `principle`, `scope`, `strength`, `exceptions`
- `strength` should be `preference`, `default`, or `hard_rule` when known.

## Question

Until Skippy exposes a dedicated `record_question` tool, store open questions as `knowledgeObject` with `objectType: "question"`.

- Required: `title`, `summary`
- Recommended `properties`: `question`, `status`, `nextReviewAt`
- Use when the user wants the question tracked or it is clearly important to an active project.

## Memory

Until Skippy exposes a dedicated `record_memory` tool, store durable user/project context as `knowledgeObject` with `objectType: "memory"`.

- Required: `title`, `summary`
- Recommended `properties`: `memoryType`, `content`, `sensitivity`, `consentMode`
- Ask first before storing sensitive personal context or inferred private facts.
