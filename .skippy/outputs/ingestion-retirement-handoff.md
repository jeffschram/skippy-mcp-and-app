# Task 9: cutover blocked; retirement deferred

2026-11-13; inspected revision `3e6c817d956ae3bed0b499cd94059680df626d00`.

Replacement validation has not passed. Fresh read-only Skippy `get_project_plan` and `get_task_brief` calls confirmed task 8's canonical result explicitly says ACCEPTANCE NOT MET, although its status is done. Two sampled read-only scheduled diagnostics did not qualify ingestion persistence/replay/recovery; Messages stable identity and reliable Google availability remain unresolved. Task 9's own brief requires passing validation first. No additional user approval is needed to resolve this documentation step; the missing prerequisite is technical evidence.

Changed repository guidance in `CLAUDE.md` and `PLAN.md` and added `docs/ingestion-cutover.md`. The runbook identifies retained Calendar write/mirror and shared runner consumers, conditional package/config/UI cleanup, credential exclusivity evidence, single-owner handoff, per-source observation checks, and rollback without overwriting data. Its operational steps are pending and have not been rehearsed in this run.

No production code, schedule, credential, host process, canonical skill or brain record was changed. No push, merge or deployment occurred. No scheduled source reads/writes were performed by this task, and absence of legacy processes was not verified. Do not complete task 9 on publication of these documents.

Machine-readable status and the canonical task 8 result excerpt are in `ingestion-retirement-status.json`. `pnpm check` passed (repository typechecks and 1,289 tests). Repository check output is in `ingestion-retirement-checks.txt`. Artifact JSON, blocked-state assertions, documentation links and inventory paths were verified; `git diff --check` passed. These checks cannot substitute for live acceptance.

Next: close replacement coverage/identity/runtime and scheduler-control gaps, record passing validation with canonical artifact IDs, then execute the staged cutover and observation procedure. Retire only components and credentials proven exclusive after post-cutover checks and rollback rehearsal pass.
