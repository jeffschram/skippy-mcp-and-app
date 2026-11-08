# Home shell implementation

Home now renders Summary, Today, Upcoming, and collapsed All before sync feedback and Quick capture. Existing legacy attention/review surfaces remain below the planning shell; their retirement is outside this task.

Upcoming covers tomorrow through the start of day eight, using civil date arithmetic for local timed items and UTC-encoded all-day dates. The Sunday-empty branch and date-range hint are removed. The internal `week` discriminator is preserved.

Summary is rendered by HomePlanning through a shared Inventory render selector, using exactly the deduplicated visible Today rows and clock. It reports overdue items, the next item kind and local time, timed event load/overlaps, and due reviews in fixed order without titles or AI calls. Zero clauses are omitted; empty/unhelpful and loading summaries are hidden; partial pages say “In shown items.” Task review dates are exposed on the existing projection, with no changes to inclusion rules or row kinds. The existing Agenda caller now supplies its clock too.

The explicit task brief's summary clauses take precedence over the checked-in contract's different attention-status clauses. Overlap and crowding coverage is preserved as requested.

Verification:
- Backend model/inventory tests: 20 passed.
- Web period, shell, and Agenda summary tests: 9 passed.
- Web and Convex TypeScript checks passed after building local workspace dependencies.
- `git diff --check` passed.

Coverage includes mixed rows, overdue-only and empty days, singular/plural and partial counts, loading/empty shell states, collapsed All, Sunday rolling windows, DST, day-eight exclusion, ongoing/all-day events, and disjoint Today/Upcoming results. Shell presentation was verified with server-rendered tests; no interactive browser QA was performed.

No push, merge, or deployment was performed.
