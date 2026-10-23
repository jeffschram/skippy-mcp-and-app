# Skippy OAuth implementation review handoff

Implemented directly by Codex at the owner's request on the existing PR #198 branch. OAuth remains disabled by default and has not been deployed or connected to the real Skippy Dot.

## Code ready for review

Protected-resource discovery, resource-bound Clerk access-JWT verification, read/write scope policy for all 83 tools, top-level and mirrored tool security metadata, HTTP/tool reconnect challenges, and a signed one-use Convex gateway are implemented. Convex resolves the authenticated identity to the owned brain and checks references. Previously public brain-facing functions and unauthenticated legacy aliases are now internal. Static tokens retain role policy and revocation checks; viewer/runner authentication stays separate.

The implementation and rollout instructions are in `docs/mcp-oauth.md`. In particular, both the MCP server and Convex require the same private bridge secret before the coordinated deployment. Ordinary remote agent clients keep their bearer tokens; trusted stdio servers must migrate to token-derived identity.

## Verification

`pnpm check` passes: all workspace and Convex typechecks and the full automated suite. New coverage exercises access-token signature/issuer/audience/type/expiry/scope rejection, account ownership, gateway tampering/replay/static revocation, internal-only targets, all registered tool metadata, and HTTP error challenges. The wire-level metadata test checks both representations because the SDK convenience parser drops the top-level extension.

The direct review used the Convex reviewer checklist. Remaining live acceptance is not replaced by unit tests.

## Release gates still pending

- Confirm canonical public host and exact ChatGPT callback/client metadata URL.
- Configure Clerk custom scopes and the actual registration mode (CIMD preferred when the Dot supplies it; predefined client otherwise).
- Prove the provider issues an OAuth access JWT bound to the exact MCP resource audience. Opaque tokens and client-ID-only audiences intentionally fail closed.
- Verify refresh issuance/rotation and account reconnection with the real provider/client. Public-key JWT verification cannot provide instant individual token revocation; see rollout documentation.
- Install server environment settings, deploy both components together, and smoke-test existing static agents.
- Run the actual Dot's discovery/login/consent/read/write/read-back/cleanup/refresh flow and cross-user rejection tests.

No provider configuration, merge, deployment, or real Dot write was performed during this implementation. Leave the task in review, not done.
