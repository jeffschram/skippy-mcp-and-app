# Skippy Dot OAuth execution plan

Enable the existing ChatGPT Dot named Skippy to read and write its authenticated owner's Skippy data through a custom MCP plugin connection. Keep scheduled agents on their existing static role-scoped tokens. This deliverable is the execution plan requested in the settled brief; it does not launch implementation, change provider settings, or deploy. OAuth acceptance remains pending the provider spike and real Dot tests below.

## Repository baseline

Inspected on October 23, 2026 at commit `febba07`. The lockfile resolves Next.js 16.2.7, `@clerk/nextjs` 7.4.3, MCP SDK 1.29.0, Convex 1.40.0 and Zod 4.4.3; the workspace pins pnpm 8.10.2 and requires Node 20 or later. No AGENTS.md was found in this worktree. The input manifest contains no attached files.

| Surface | Finding and required change |
| --- | --- |
| `apps/web/app/api/mcp/route.ts` | Exports GET, POST and DELETE. Missing tokens produce a bare 401; caught failures expose error messages and also become 401. Add discovery challenges and typed, sanitized error handling. |
| `apps/mcp-server/src/remote.ts` | Authenticates through `mcpTokens:authenticate`, creates a brain-bound client/server and uses the Web Standard Streamable HTTP transport. Preserve this static path while adding a separate verified OAuth principal. |
| `apps/mcp-server/src/mcp-server.ts` | Registers 76 literal tools plus seven generated `upsert_*` tools. Existing annotations need a behavior audit. No tool securitySchemes are present. Prompts and resources also call private skill retrieval and need authorization. |
| `apps/mcp-server/src/skippy-client.ts` | Calls brain-facing Convex functions with a brain ID and optional shared `CONVEX_AUTH_TOKEN`. This does not establish an OAuth user's identity. |
| `convex/auth.ts`, `convex/auth.config.ts` | Maps Clerk subject to an existing user and owned brain; configured browser audience is `convex`. Preserve browser authentication and reject unknown OAuth users. |
| `convex/projectFiles.ts` | Brain-facing public functions accept caller-supplied brain IDs. For example, `getFileForBrain` compares the record to that argument without authenticating its owner; `generateUploadUrlForBrain` has no identity check. A new protected route alone cannot close this direct Convex bypass. |
| `apps/web/proxy.ts` | Clerk middleware currently matches only `/share`. Extend narrowly if the chosen Clerk helpers require it; metadata must stay public and API requests must not redirect to browser sign-in. |
| `convex/mcpTokens.ts`, `role-policy.ts` | Static tokens use hashed lookup and revokedAt checks. Role filtering and role-dependent handler behavior must remain intact, including calendar approval behavior. |

The Convex workflow deploys on main changes and warns that the live backend is named a development deployment. Do not treat a `dev:` name as a disposable test environment. The runner owns publishing after approval; this worktree must never push, merge or deploy.

## Phase 1 Prove provider and client compatibility

Owner/admin supplies access to an isolated Clerk and Convex test setup and the existing Skippy Dot's MCP management screen. Use synthetic data and a stable test HTTPS origin. Record exact nonsecret values in the connection record below. Never copy secrets, codes, verifiers, access tokens, refresh tokens or complete authorization headers into artifacts.

Current OpenAI guidance supports CIMD, predefined clients and DCR, requires S256 discovery, and ties the callback and client metadata URL to the actual connection. Copy those values from management; do not derive them from the Dot name. Advertise issuer-response support only after successful and error callbacks both return the exact issuer. [OpenAI authentication](https://developers.openai.com/plugins/build/auth)

Clerk documents custom scopes and configurable default grants. Advertising a scope is distinct from assigning it to an application. Its current implementation supports CIMD, whereas legacy OAuth implementations may not. These are documented capabilities, not proof of this instance's settings. [Clerk OAuth implementation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)

1. Fetch the actual issuer's authorization metadata. Record issuer, authorization/token/JWKS/introspection/revocation endpoints as applicable, supported token authentication, S256 and registration capabilities. Inspect SDK/helper behavior against the installed versions before adding dependencies.
2. Prefer CIMD using the exact ChatGPT metadata URL. In Clerk, explicitly allow that client and assign the intended scopes; prefer pre-registered-only admission. Verify public exchange with `none`. Clerk documents S256 and consent for CIMD, and automatically includes offline access for this mode. Verify refresh behavior rather than assuming a universal `offline_access` rule. [Clerk CIMD configuration](https://clerk.com/docs/guides/configure/auth-strategies/oauth/client-id-metadata-documents)
3. If CIMD fails in the actual connection, test predefined registration with the exact redirect and required PKCE. Enable DCR only if necessary, and record why. Never invent a separate Dot client identity or wildcard redirect. Preserve registered credentials across reconnects.
4. Create and assign proposed `skippy:read` and `skippy:write` scopes. Exercise explicit scopes, omitted scopes, partial grants and unknown scopes. If ChatGPT omits scope, any full-access default must be an explicit provider consent/configuration choice; an absent granted-scope field must never mean full access.
5. Complete discovery → authorization code with S256 → exact callback → token exchange → minimal authenticated read in the existing Dot. Capture a redacted sequence and timestamps. Negative checks: wrong verifier, reused code, mismatched redirect, omitted/wrong resource, and a token issued for a different resource. The resource must survive both authorization and token requests and be available to the verifier as authenticated audience/resource data. Client ID alone is not resource binding.
6. Select and record the token format. Proposed preference: opaque access tokens with online verification on every private operation for prompt revocation, only if this registration mode supports the format and exposes sufficient authenticated resource, subject, expiry and scope data. JWT is a valid alternative: verify signatures with trusted keys, algorithm restrictions, issuer, audience, expiry and access-token type. Local JWT verification alone does not provide immediate revocation; specify and test an additional revocation check or obtain an explicit decision on a bounded revocation delay. [Clerk token formats](https://clerk.com/docs/guides/development/machine-auth/token-formats)
7. Test access expiry, refresh after a new MCP request/session, refresh rotation, old-refresh replay, revocation of access and refresh credentials, and reconnect. Record actual lifetimes, rotation/grace behavior and revocation latency. Keep tokens in provider/client secure storage.

Exit gate: all compatibility evidence recorded, including real Dot success. Resource-binding failure, unavailable required scopes, unprovable revocation or an incompatible callback is a blocker. Do not compensate by accepting unbound tokens, rewriting issuer identity, forwarding browser tokens, or adding a homemade OAuth server. Escalate the specific provider limitation for a design decision.

## Phase 2 Implement discovery and authentication

Retain `/api/mcp` and the existing transport. Introduce server-side `SKIPPY_MCP_OAUTH_ENABLED`, default false, plus validated explicit issuer and canonical resource configuration. Avoid deriving security URLs from untrusted Host or forwarded headers. Rollback must disable OAuth while keeping static-token requests working.

Publish `/.well-known/oauth-protected-resource/api/mcp` for the path-specific resource, and a root discovery alias if needed by the tested client. Return the canonical full HTTPS `/api/mcp` URL as `resource`, the real issuer in `authorization_servers`, and supported scopes. Serve GET and OPTIONS publicly with the required CORS headers. Use actual issuer authorization metadata; add a compatibility proxy only if a recorded client failure requires one, preserving issuer identity. Clerk offers Next.js metadata/CORS and token helpers; evaluate them without replacing the transport or migrating to Express. [Clerk MCP guide](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server)

Normalize verified authentication into an explicit discriminated principal: legacy static principal with its role, or OAuth principal with trusted issuer, subject, resource, expiry and granted scopes. Never represent OAuth by omitting a legacy role and inheriting unrestricted access. Route known `skippy_` static credentials to the existing verifier; invalid static tokens must not fall through to OAuth, nor should provider failures fall through to static authentication.

| Condition | Response |
| --- | --- |
| Missing, invalid, expired, wrong issuer/resource or wrong token type | 401 with Bearer `WWW-Authenticate` and `resource_metadata`; invalid credentials use `error="invalid_token"`. |
| Authenticated but insufficient permissions | 403 with Bearer `error="insufficient_scope"` and required `scope`. |
| Tool authorization fails after transport authentication | `isError: true` and `_meta["mcp/www_authenticate"]` Bearer challenges containing error, error_description, resource_metadata and applicable scopes. |
| Unknown user, missing owned brain or foreign reference | Deny without provisioning, owner fallback or disclosing another account's records. Use a consistent not-found/forbidden policy. |
| Provider unavailable, Convex unavailable or internal defect | Sanitized 5xx, correlation ID and redacted server diagnostics. Do not trigger misleading login loops. |

Validate at each private request and operation, including expiry/revocation during a long-lived connection. Never authorize by a cached MCP session ID. Validate tokens as access tokens rather than accepting ID tokens with superficially similar claims. Apply the same boundary to private prompts and resources; only genuinely static documentation may be anonymous. Initialization and tool discovery must work in the observed ChatGPT flow, without returning owner data before authorization.

## Phase 3 Establish the Convex account boundary

Prefer a narrowly authenticated server bridge unless the spike proves a viewer-auth path with the exact intended claims. Do not alter the existing `convex` browser audience just to accept an MCP token.

For the bridge, create a fixed operation allowlist and shared domain helpers behind internal Convex functions. Use a dedicated server credential or short-lived signed assertion validated by Convex, carrying the verified issuer/subject, grants, source-token expiry, operation, request body digest and replay protection. Set bridge expiry no later than source expiry. Keep keys server-side, support rotation, and test forgery, replay, expired assertions, modified arguments and wrong bridge audience. Do not expose arbitrary function dispatch or a public lookup by arbitrary user ID.

Convex resolves `(authProvider = clerk, authUserId = verified subject)` to the existing user and owned brain for every operation. Resolve identity before inspecting client references. Ignore or reject identity/brain overrides in top-level and nested payloads; do not allow object spreads to overwrite server-derived identity. Unknown users fail closed. Check every referenced task, project, phase, person, company, memory, note, relationship endpoint, financial account, interview, pending action, file and upload against that brain. Validate both ownership and relationships such as phase/task/project consistency.

Treat file upload tickets, storage IDs and download URLs as capabilities: bind upload completion and cleanup to the authorized upload/owner/project, prevent attaching foreign storage IDs, check ownership before generating download URLs, and do not persist expiring URLs as canonical artifacts.

Audit every public Convex entrypoint reachable through `skippy-client.ts`, not only files. Replace unauthenticated `*ForBrain` access with authenticated adapters or internal functions. Migrate scheduled/static clients through an adapter that verifies the existing token, role and current revocation on each operation; preserve the external static-token contract. Inventory stdio, runner and other callers before removing old entrypoints. An anonymous direct Convex call must not bypass the new route. This is a prerequisite for claiming the account-boundary acceptance criterion.

## Phase 4 Enforce the tool permission contract

Proposed consent model: `skippy:read` permits reading all exposed personal-assistant domains; `skippy:write` permits changes to those domains. Require both for write tools. These are Skippy design choices, not OpenAI-required scope names. Use plain consent descriptions identifying tasks, projects, people/companies, goals, memory, notes, library, finances, interviews, calendar proposals, notifications and pending actions. Provider validation in Phase 1 must precede finalizing the names.

Use a single explicit per-tool policy registry to generate required scopes, top-level `securitySchemes`, the `_meta.securitySchemes` mirror, and enforcement wrappers. New or unmapped tools fail closed. Keep legacy role policy separate and preserve its handler restrictions. Missing scopes never inherit the legacy unrestricted role. Cross-domain tools use the broad scope pair, preventing an aggregate search or generic ingestion path from bypassing domain checks.

The companion tool inventory covers all 83 current registrations and proposes scopes. Audit actual side effects before finalizing each row: database-backed synthesis can write derived state; external URL fetching can make openWorldHint true even when owner data is read-only. Add explicit readOnlyHint, destructiveHint and openWorldHint values to every OAuth-exposed descriptor. Upserts that overwrite data, cancellation, archive, upload abort and external actions need individual review; existing hints are not authoritative. Annotations never authorize access or replace existing action approval rules.

Preserve accurate descriptor serialization with MCP SDK 1.29.0. Add a tools/list contract test for required fields and mirrors, and execution tests proving the declared scopes match enforcement. Test direct calls to undiscovered/unmapped tools and prompt/resource access. Refresh the ChatGPT connection after descriptor changes.

## Phase 5 Verify in automation and the existing Dot

| Suite | Required evidence |
| --- | --- |
| Discovery and transport | Exact metadata URLs/resource/issuer, public GET/OPTIONS/CORS, 401 challenges, initialize/tools/list/tools/call, supported methods and stateless or session behavior. |
| Token verifier | Valid credentials; bad signature, unknown key, wrong algorithm, wrong issuer/audience, absent audience, expired/future token, ID token, absent/partial/unknown scopes, revoked token, unavailable verifier. |
| Account boundary | Two users and brains; unknown identity; foreign references for every exposed domain; nested references; bridge forgery/replay; storage ownership; direct anonymous Convex calls. |
| Tool policy | All registrations covered; exact scheme/mirror equality; explicit annotations; no silent grants; scope checks before side effects; tool reauthentication payloads. |
| Static regression | Valid unscoped tokens, every role, parameterized pm role, forbidden tool calls, revocation during reuse, calendar restrictions, and OAuth gate off. |
| Operational errors | Provider/Convex outage and unexpected exceptions return redacted 5xx rather than 401. |

Run focused MCP, web-route and Convex-boundary suites, then `pnpm check`. Add new boundary tests explicitly to the root test command if needed: the current root command enumerates selected Convex tests and would not automatically discover every new suite. Do not run production smoke scripts as a substitute for an isolated test environment.

The owner completes login/consent in ChatGPT. Test the installed custom plugin from the existing Skippy Dot, not a replacement Dot or only an MCP Inspector. Record: discovery and linking; tool discovery; authenticated owner read; an isolated project-note write with a unique marker, readback and restoration of original content; wrong-user rejection; refresh after access expiry; access/refresh revocation; and reconnection. Verify cleanup and preserve intended audit history. Do not test external notification delivery or calendar execution as the reversible write. Developer-client success is supporting evidence only. Every owner-only step remains marked pending until observed.

## Phase 6 Prepare review and release

Prepare reviewable changes in dependency order: provider evidence; Convex boundary and legacy adapter; gated OAuth/discovery; tool contracts; integration tests and setup instructions. Each slice states prerequisites and residual risks. Load the repository's Convex expert/reviewer guidance when implementing Convex changes. Avoid a partially published configuration where discovery advertises unsupported behavior.

Supply the runner a PR title/body and validation evidence; the runner handles publication after approval. Do not create a remote PR by pushing from this task. The eventual implementation PR must contain provider setup, exact nonsecret connection values, actual Dot evidence and remaining manual checks. Baseline tests or completed discovery alone do not constitute OAuth completion.

For release, enable the gate only after the test connection passes. Monitor authentication status, denied scopes and dependency failures using redacted identifiers. Rollback switches OAuth off, revokes the test/affected provider grants as appropriate, and verifies static agents still initialize/list/call with their existing tokens. Keep the authenticated Convex boundary intact during rollback; never restore anonymous access to recover service.

## Nonsecret connection record

Populate this record from actual management/configuration and successful test evidence before release. Unset fields are blockers to final connection instructions, not guessed values.

| Field | Current value or required source |
| --- | --- |
| Client | Existing ChatGPT Dot named Skippy |
| Transport and path | HTTPS Streamable HTTP at `/api/mcp` |
| Test and production public MCP URLs | Pending verified deployment origins; record separately |
| Canonical resource | Exact full MCP URL for that environment; pending |
| Protected-resource metadata URL | Proposed origin plus `/.well-known/oauth-protected-resource/api/mcp`; verify |
| Provider and issuer | Clerk; exact issuer pending instance inspection |
| Registration mode | CIMD preferred; not yet verified |
| Client metadata URL and redirect URI | Copy exact values from that MCP connection's ChatGPT management page |
| Predefined client ID if fallback is needed | Provider-issued value only; pending |
| Token endpoint authentication | Prefer `none` for tested public CIMD; pending |
| Issuer response support | Pending tests of success and error authorization responses |
| Granted permissions | Proposed `skippy:read skippy:write`; record actual grants and provider defaults |
| Access format and revocation | Opaque preferred conditionally; record measured behavior and chosen format |
| Refresh policy | Record issuance, persistence, rotation/replay and revocation observations |
| Convex handoff | Authenticated bridge proposed; implementation and proof pending |
| Package | Create only what the actual custom MCP setup requires; no speculative manifest or Dot identity |
| Release status | Planning complete; implementation and real Dot acceptance pending |

Connect through ChatGPT Plugins → Add custom MCP server, configure the verified HTTPS URL and OAuth fields, install the resulting plugin and make it available to Skippy. A package is conditional on the actual setup; portable MCP auth belongs to its MCP server configuration, and secrets belong only in secure setup fields. [Custom MCP connection](https://developers.openai.com/api/docs/mcp), [plugin packaging](https://developers.openai.com/plugins/build/plugins). Consult the [plugin reference](https://developers.openai.com/plugins/reference) when serializing metadata; no custom UI is required here.
