# Apple Calendar and Reminders integration for Skippy

Date: 2026-08-24

## Summary

Codex can work with Apple Calendar and Reminders on the Mac, although OpenAI does not currently document a dedicated Apple Calendar or Apple Reminders connector.

The functionality can instead be provided through local Mac application control, AppleScript or Shortcuts, or purpose-built Skippy MCP tools. Purpose-built tools are the recommended long-term approach because they are more reliable and constrained than repeatedly controlling the graphical interface.

## Available approaches

### 1. Mac application control

Codex can operate the native Calendar and Reminders applications through their visible interfaces.

Advantages:

- Can work without developing a dedicated integration first.
- Supports reading and ordinary application actions.
- Useful for proving the workflow.

Limitations:

- Slower than a direct integration.
- Sensitive to application layout and UI changes.
- Harder to validate and automate reliably.

### 2. AppleScript or Apple Shortcuts

Skippy can invoke a local AppleScript or Shortcut to create, find, update, and complete reminders or calendar events.

Advantages:

- Relatively quick to implement.
- More deterministic than UI automation.
- Runs locally on the Mac mini.
- Can be exposed through narrowly scoped commands.

Limitations:

- Requires macOS Automation, Calendar, and Reminders permissions.
- Some advanced behaviors may be awkward or unsupported.
- Scripts need clear validation and error handling.

### 3. Purpose-built Skippy MCP tools

The best long-term design is to expose focused tools through the Skippy MCP and execute them through the trusted Mac mini runner. AppleScript can power the first implementation; EventKit or another native helper can replace it later without changing the MCP interface.

Suggested tools:

- `list_reminders`
- `create_reminder`
- `update_reminder`
- `complete_reminder`
- `list_calendar_events`
- `find_calendar_availability`
- `create_calendar_event`
- `update_calendar_event`
- `delete_calendar_event`

## Recommended architecture

```text
Skippy chat or task
        ↓
Constrained Skippy MCP tool
        ↓
Mac mini runner
        ↓
AppleScript / Shortcuts initially
EventKit helper eventually
        ↓
Apple Calendar or Reminders
```

The MCP contract should remain independent of the Apple automation implementation. This makes it possible to start simply and move to a native EventKit helper later.

## Example requests

- “Remind me tomorrow at 9 AM to call the dentist.”
- “Add Jeff’s appointment to my Personal calendar next Tuesday.”
- “What does my afternoon look like?”
- “Find an open hour on Thursday afternoon.”
- “Move the project review to Friday at 10 AM.”
- “Mark the grocery reminder complete.”

## Tool input design

Creation tools should accept explicit structured fields rather than an unrestricted command string.

For reminders:

- title
- notes, optional
- due date and time, optional
- timezone
- reminder list
- priority, optional
- recurrence, optional and only when deliberately supported

For calendar events:

- title
- start date and time
- end date and time or duration
- timezone
- calendar
- location, optional
- notes, optional
- attendees, optional
- recurrence, optional

The tool should resolve natural-language dates before invoking Apple automation and show the resolved absolute date when ambiguity matters.

## Permissions

The Mac mini runner or its native helper will need the appropriate macOS permissions, potentially including:

- Calendar access
- Reminders access
- Automation permission to control Calendar, Reminders, or Shortcuts
- Accessibility permission if graphical application control is used

Permissions should be granted only to the specific runner or helper that needs them.

## Safety and confirmation model

- Reading and listing can normally proceed without confirmation.
- Creating a reminder or event can proceed when the user supplied a clear title, date, destination list/calendar, and relevant timezone.
- Ask for clarification when the date, time, calendar, or reminder list is ambiguous.
- Confirm destructive or broad actions, such as deleting many events or reminders.
- Confirm before sending invitations or materially changing attendee-visible events when the user's intent is not already explicit.
- Return the final normalized record so the user can see exactly what was created or changed.

## Recommended implementation sequence

1. Build read-only Calendar and Reminders scripts and verify permissions.
2. Add `list_reminders` and `list_calendar_events` runner operations.
3. Add narrowly scoped creation tools with explicit inputs and normalized results.
4. Add update and completion operations.
5. Add availability search and recurrence only after the basic paths are reliable.
6. Persist audit records in Skippy for every requested and completed external change.
7. Consider replacing AppleScript with an EventKit-based native helper if reliability or capability becomes limiting.

## Recommendation

Begin with AppleScript-backed MCP tools running on the Mac mini. This is a small, practical bridge to native Apple data and is more reliable than controlling the Calendar and Reminders interfaces for every request. Preserve a clean MCP contract so the underlying implementation can later move to EventKit without changing how Skippy or its agents use the tools.

## Reference

OpenAI presents integrations and calendar-context workflows as Codex use cases, but its public documentation does not currently establish a dedicated Apple Calendar or Apple Reminders connector: [Codex use cases](https://developers.openai.com/codex/use-cases).
