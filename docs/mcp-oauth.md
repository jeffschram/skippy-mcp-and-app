# ChatGPT Skippy OAuth rollout

The remote MCP resource remains `https://<approved-production-host>/api/mcp` (Streamable HTTP). Configure the exact URL as `SKIPPY_MCP_RESOURCE_URL`; do not substitute a ChatGPT client ID for this resource audience. The repository and earlier project notes mention different hosts, so confirm the deployed canonical host before enabling discovery.

## Implemented

- Protected-resource discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`, advertised in Bearer challenges.
- Clerk OAuth access JWT verification: RS256 signature from the configured issuer's JWKS, exact issuer/resource audience, expiry, required subject/issued-at, OAuth access-token type, and grants. Browser session/ID tokens, opaque tokens without resource evidence, and unrelated audiences are rejected.
- All 83 tools have explicit grants, both securitySchemes representations, read/write hints, and tool-level reconnect challenges. `skippy:read` permits reads; writes require both `skippy:read` and `skippy:write`. `ask` and summary-generation tools that can persist generated state require write; reading the latest saved summary and current app context only requires read. Write tools conservatively advertise destructive potential because they can update existing state.
- Convex resolves the Clerk subject to an existing user and owned brain. It never auto-provisions an account or accepts a supplied account as authority.
- The MCP server signs exact operations/arguments for a short-lived, one-use Convex gateway. Convex rechecks principal expiry, resource configuration, scopes, and referenced-row ownership. Brain-facing entrypoints are internal, including older aliases that bypassed authentication.
- Static tokens retain their token-derived roles; Convex rechecks revocation on each operation. Browser viewer and runner-host authentication remain separate.

## Deployment prerequisites

This is a coordinated backend/server change. Do not deploy only one half and expect old direct Convex MCP clients to work.

1. Generate a cryptographically random bridge secret (at least 32 characters) and store it as `SKIPPY_MCP_BRIDGE_SECRET` in both the Next/MCP server environment and Convex. Keep it out of chat, Git, browser bundles, and client packages. It is a privileged server credential, not a ChatGPT credential.
2. Deploy the Convex schema/internal functions and MCP web server together in a planned rollout. The secret must already exist on both sides. Existing HTTP agent clients retain their URLs and bearer tokens; smoke-test their role-specific tools immediately. OAuth remains disabled by default.
3. Trusted local stdio servers now need `SKIPPY_CONVEX_URL`, `SKIPPY_MCP_TOKEN`, and the bridge secret. An unauthenticated brain ID is no longer enough; the token supplies the brain and role. Prefer the remote HTTP connection for ordinary clients so they never receive the bridge secret.
4. Set `SKIPPY_MCP_OAUTH_ISSUER` and `SKIPPY_MCP_RESOURCE_URL` identically on Next/MCP and Convex. The issuer must be the same Clerk instance as the app's existing users.
5. Configure the provider as below, then set `SKIPPY_MCP_OAUTH_ENABLED=true` on both services for the controlled acceptance test. Disabling this flag on either service prevents OAuth access without disabling static tokens.

`pnpm prod:check` checks the local server prerequisites without printing secrets. The ingestion/triage smoke script now additionally needs an owner Clerk JWT with Convex audience in `SKIPPY_CONVEX_AUTH_TOKEN` for authenticated review and cleanup; a static MCP token no longer bypasses browser review authorization.

## Clerk and ChatGPT setup still required

Preferred registration is CIMD **if the actual Dot setup supplies it**. The inspected issuer does not currently advertise CIMD or the Skippy scopes. Clerk supports configuration of these capabilities; code alone cannot enable them.

- Create and advertise `skippy:read` and `skippy:write`; allow both for the ChatGPT client. Keep consent enabled. Request the provider's refresh permission (`offline_access` for Clerk) as needed.
- Enable CIMD publication and allow the exact ChatGPT metadata-document client URL when available. Otherwise use a predefined OAuth client supported by the actual setup. DCR is not mandatory.
- Require authorization code with PKCE S256. Copy the exact callback from ChatGPT's MCP setup; do not guess a Dot-specific ID or use wildcard callbacks. If using the issuer-bound stable callback, verify the provider advertises response `iss` support and returns the matching issuer.
- Configure JWT access tokens and prove the `resource` authorization parameter results in `aud` containing the exact MCP resource URL. An ID token's client-ID audience is not sufficient. **If Clerk cannot issue that resource-bound access token, keep OAuth disabled and resolve the provider capability; do not loosen audience validation.**
- Verify refresh issuance and public-client refresh rotation with the actual provider/client flow. The resource server never stores client secrets or refresh tokens. ChatGPT and Clerk perform authorization, callback, and refresh.
- JWT verification follows Clerk's documented public-key path; access JWTs are not instantly revoked by changing provider settings. Expiry and local account access still apply. Immediate individual OAuth token revocation requires a provider-supported resource-bound introspection design; opaque tokens are intentionally not accepted here.

## Acceptance evidence before calling the feature live

Automated tests cover signature tampering, expiry, issuer/audience/type, grants, account references, gateway replay/static revocation, both tool metadata representations, and HTTP challenges. These do not prove the provider authorization flow.

Run discovery → login/consent → callback → `get_project_plan` → a clearly labeled test write → read-back → cleanup through the actual Skippy Dot. Then exercise refresh and reconnect, wrong-audience/expired access tokens, read-only consent attempting a write, unknown Clerk account, foreign task/project/file references, and an existing scheduled agent's static token. Keep tokens/secrets out of test reports. Record the actual resource URL, issuer, registration mode, callback, and pass/fail results.

Rollback OAuth access by disabling the flag on both services. Retain the authenticated Convex boundary and static-token gateway; reverting only the web server to direct public Convex calls will break compatibility and reintroducing unauthenticated endpoints is not a safe rollback.

References: [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth), [Clerk OAuth configuration](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth), [Clerk token verification](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens).
