# Skippy Onboarding: Harness Connection Verification

## Goals

Primary goal: get a new signed-in user from "I have a Skippy account" to "my AI harness is connected to my Skippy MCP" with minimal confusion.

Secondary goals:

- Explain that a harness is the external AI environment, such as Codex, Claude, or Hermes, that calls Skippy MCP.
- Make token privacy and consent obvious before the user copies credentials.
- Keep the first-run path short enough for web/PWA use.
- Verify a real authenticated MCP call before unlocking core Skippy workflows.

Current architecture assumptions:

- The web app uses Clerk identity, then `auth.ensureViewer` creates a Convex `users` row, `brainInstances` row, and `brainConfigs` row.
- MCP access already uses bearer tokens through `apps/web/app/api/mcp/route.ts`.
- Tokens are generated in Convex by `mcpTokens:create`, stored hashed in `mcpTokens`, and mapped to a `brainInstanceId` by `mcpTokens:authenticate`.
- The main app navigation lives in `apps/web/app/components/app-shell.tsx`.

## Screen And State Model

### Screen A: Welcome To Skippy

Entry condition: the user has authenticated with Clerk and `ensureViewer` has bootstrapped a brain, but the brain has no verified harness connection.

Content:

- Headline: "Welcome to Skippy"
- Subhead: "Skippy is your second brain and project dashboard. Connect an AI harness so it can capture context, work Ready tasks, and report results back for review."
- Three plain steps:
  1. Create a personal MCP token.
  2. Add the Skippy MCP endpoint and token to your harness.
  3. Verify the harness can talk to Skippy.
- Primary CTA: "Connect harness"

Exit condition: the user clicks "Connect harness" and moves to the connection screen.

### Screen B: Connect Your Harness

Entry condition: user is authenticated and has not completed connection verification.

Content:

- MCP endpoint URL: `https://skippy.jeffschram.dev/api/mcp` for production, with local/dev endpoint shown only in development.
- Token generation UI:
  - Label field, defaulting to the harness name if known.
  - "Generate token" button.
  - One-time token reveal with copy button.
  - Warning: "This token is shown once. Store it in your harness secret manager. Do not paste it into chat."
- Generic harness setup block:
  - Endpoint: copyable.
  - Bearer token: user-generated.
  - Restart/reload harness if required.
- Verification block:
  - "Verify connection" button.
  - Status: idle, waiting, verified, failed.
  - Retry button after timeout/failure.

Exit condition: verification succeeds and the user moves to the confirmation screen.

### Screen C: Connection Verified

Entry condition: Skippy has recorded a recent valid MCP token use or challenge response for the user's brain.

Content:

- Success message: "Your harness is connected."
- Short explanation: "Skippy can now receive task results, memory captures, and project context from your harness."
- Minimal CTAs:
  - "Open Projects"
  - "Open Inbox"
  - "View Skills"

Exit condition: user enters the main app.

## Error States

- Token invalid or expired: "The token was rejected. Generate a new token and update your harness secret."
- Harness cannot reach MCP: "The harness could not reach the MCP endpoint. Check the URL and network access."
- User mismatch: "The token belongs to a different Skippy brain. Use a token generated from this account."
- Verification timeout: "Skippy has not seen a connection yet. Restart the harness, confirm the token, then retry."
- Backend unavailable: "Skippy could not verify right now. Try again in a moment."

Troubleshooting bullets:

- Confirm the MCP endpoint is exactly `https://skippy.jeffschram.dev/api/mcp`.
- Confirm the token is configured as a bearer token or secret, not pasted into a chat message.
- Restart the harness after changing MCP settings.
- Revoke old tokens you no longer use.
- Generate a fresh token if you cannot confirm where the old one was stored.

## Recommended Verification Handshake

Use a challenge-based handshake.

1. Web app creates a Convex verification challenge record for the current brain.
2. The page displays the challenge ID and waits for completion.
3. Harness calls a new MCP tool such as `verify_connection` with the challenge ID.
4. MCP authenticates the bearer token, maps it to `brainInstanceId`, and writes the challenge response.
5. Convex marks the user verified when the challenge brain matches the authenticated token brain.

Why this is preferred:

- It proves the web user and harness token point to the same brain.
- It avoids treating any stale token use as a completed onboarding.
- It gives the UI a clean retry/timeout state.

Fallback verification:

- A harness heartbeat event can update `harnessConnections.lastSeenAt`.
- The web app may consider a user verified if a non-revoked token for their brain was used in the last 10 minutes.
- This is simpler, but less explicit than a challenge.

Conceptual Convex fields:

- `users.onboardingStatus`: `new` | `needsHarness` | `verified`
- `mcpTokens`: already exists with `tokenHash`, `createdAt`, `lastUsedAt`, `revokedAt`
- `harnessConnections`: `brainInstanceId`, `firstSeenAt`, `lastSeenAt`, `harnessType`, `version`, `lastTokenId`
- `harnessVerificationChallenges`: `brainInstanceId`, `challenge`, `status`, `createdAt`, `expiresAt`, `verifiedAt`, `verifiedByTokenId`

Verification success condition:

- Preferred: a pending challenge for the user's brain is answered by an authenticated MCP request for the same brain before `expiresAt`.
- Fallback: a valid non-revoked token for the user's brain has been used successfully against MCP within the last 10 minutes.

## App Gating Rules

Accessible before verification:

- Welcome and connect-harness screens
- About/help content
- Token management
- Basic profile/settings required to complete setup
- Skills pages that explain how to connect

Soft-gated before verification:

- Today/Home
- Projects
- Brain/Library
- Review/Inbox
- Actions and automation controls

Navigation behavior:

- If an unverified user opens a gated route, redirect to `/welcome` or `/connect-harness`.
- Show a banner: "Connect your harness to continue."
- Desktop nav may show locked items disabled with a short tooltip.
- Mobile nav should avoid disabled-looking dead ends; route gated taps to onboarding with the banner.

## Copy

Welcome headline:

> Welcome to Skippy

Welcome subhead:

> Skippy is your second brain and project dashboard. Connect an AI harness so it can capture context, work Ready tasks, and report results back for review.

Connection steps:

1. Generate a personal MCP token.
2. Add the Skippy MCP endpoint and token to your harness.
3. Ask your harness to verify the connection.

Verification in progress:

> Waiting for your harness to contact Skippy.

Success:

> Your harness is connected.

Failure:

> Skippy could not verify the connection yet. Check the endpoint, token, and harness restart state, then try again.

## Implementation Checklist

Web app:

- Add `/welcome` and `/connect-harness` routes.
- Add token generation UI with one-time reveal and copy controls.
- Add challenge creation, polling, retry, and timeout states.
- Add route guards for gated routes.
- Add locked/redirecting navigation states.
- Add concise troubleshooting content.

Convex:

- Add onboarding status to the user or brain config model.
- Keep token storage hashed and revocable.
- Add challenge or harness heartbeat tables.
- Add queries/mutations for create challenge, answer challenge, read verification status, and mark onboarding verified.
- Record activity events for token creation, revocation, and successful verification.

MCP server:

- Add a `verify_connection` MCP tool that accepts a challenge ID.
- Validate bearer token through existing token auth.
- Ensure challenge brain matches authenticated token brain.
- Update `harnessConnections` on successful authenticated requests.
- Never log raw token values.

## Completion Check

This design is complete when implementation work can proceed from:

- Screen list and state model
- Verification handshake
- Error states and troubleshooting copy
- App gating rules
- Web, Convex, and MCP implementation checklist

