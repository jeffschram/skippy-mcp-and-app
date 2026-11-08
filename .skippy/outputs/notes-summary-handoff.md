# Notes summary change

This checkout did not contain convex/todayModel.ts or the newer Today briefing described in the brief. Home rendered a stored focus summary, including a separate actionable bullet list, above AttentionFocus and the agenda. The change removes that redundant summary/list from Home while preserving source-sync status and the existing cards.

Added convex/todayModel.ts as a pure deterministic summary producer. Home's AgendaSection feeds it the exact Today projection used by its rows, with no additional query or AI call. Four or more timed events produce a single factual schedule sentence; overlapping timed events produce one exception sentence. Output is at most two short sentences. Quiet, empty, and task-only days produce null, so the renderer omits the summary paragraph. Titles are excluded from the producer's input contract. All-day events and unknown/invalid durations do not fabricate conflicts.

Agenda day grouping now uses the existing minute clock, including refreshing its date range across midnight, and uses local calendar arithmetic for the range end. Summary and cards derive from one query response and one day projection. Existing stored focus generation APIs remain available to other consumers.

Verification:
- pnpm check passed (all workspace typechecks and tests).
- Five producer tests cover crowded, quiet, empty, task-only, overlap, all-day, missing duration, removal and rescheduling cases.
- Three renderer tests verify conditional hiding, titles rendered only once, current Today projection, and exclusion of tomorrow's events.
- Web typecheck passed again after adding renderer tests.
- git diff --check passed.

No live browser/deployment validation was performed. No push, merge, or deployment was attempted.
