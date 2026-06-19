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
