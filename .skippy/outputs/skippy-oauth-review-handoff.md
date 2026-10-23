# Skippy OAuth plan review handoff

Prepared the execution plan and complete proposed permission inventory for the existing ChatGPT Skippy Dot. Application code and provider configuration are unchanged. The plan covers the provider compatibility spike, discovery, authenticated Convex handoff, all 83 registered tools, legacy token preservation, rollback, real Dot acceptance and nonsecret connection instructions.

The main prerequisite discovered during inspection is the public Convex brain-facing surface: some functions authorize references against a caller-supplied brain ID without authenticating the caller. The implementation must close direct backend bypasses as well as protect the MCP route, while migrating existing static clients safely.

## Deliverables

- `skippy-oauth-execution-plan.md`: ordered phases, decisions, gates and exact setup fields to collect.
- `skippy-oauth-tool-inventory.md`: 83 unique tools with proposed permissions; provider support and side-effect audits must precede enforcement.

## Verification performed

On October 23, 2026, `pnpm check` exited 0: workspace and Convex typechecks passed; 92 test files and 1,182 tests passed, including the MCP and web suites. These are baseline regression results, not OAuth acceptance evidence. The inventory was compared with all 76 literal registrations plus the seven generated upsert registrations. Current official OpenAI and Clerk guidance was checked and linked in the plan.

## Remaining implementation acceptance

No provider configuration, public test origin, exact ChatGPT callback/client metadata URL, resource-binding proof, access format, registration mode or real Dot OAuth test has been established in this planning run. Login/consent, write/readback/cleanup, refresh, revocation and reconnection remain pending. New security suites must be implemented and passed. The nonsecret setup record must be completed from verified values before release.

## Runner review proposal

Suggested review title: Plan OAuth access for the existing Skippy ChatGPT Dot.

Suggested review description: Adds a repository-grounded execution plan and proposed permission inventory for OAuth read/write access from the existing Skippy Dot. Defines a Clerk compatibility gate and authenticated Convex boundary, preserves scheduled static-token agents, and requires real Dot evidence before release. Baseline validation: pnpm check passed, including 1,182 tests. Implementation and provider/client verification remain pending.

No push, remote PR, merge or deployment was performed. The runner owns publishing after approval. A subsequent implementation PR must include the verified provider record and actual Dot evidence; this planning review does not satisfy those release criteria.
