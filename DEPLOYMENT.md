# Skippy Production Deployment

Production app URL:

- `https://skippy.jeffschram.dev`
- MCP endpoint: `https://skippy.jeffschram.dev/api/mcp`

## Required Vercel Environment

- `CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`

## Recommended Vercel Environment

- `CLERK_SECRET_KEY`, if later server-side Clerk APIs are used.
- `SKIPPY_VAPID_PUBLIC_KEY` or `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, for browser push subscription.
- `SKIPPY_VAPID_PRIVATE_KEY` or `VAPID_PRIVATE_KEY`, for push dispatch.
- `SKIPPY_VAPID_SUBJECT` or `VAPID_SUBJECT`, such as `mailto:you@example.com`.

## Convex Configuration

- Clerk JWT issuer/domain must match the Clerk application used by the deployed app.
- OpenAI API key should be configured where server-side Convex/MCP execution needs it.
- MCP tokens are stored in Convex and can be created from the Settings page.

## Verification

Run locally with production values loaded:

```sh
pnpm prod:check
```

To smoke-test the deployed MCP endpoint:

```sh
SKIPPY_MCP_URL=https://skippy.jeffschram.dev/api/mcp pnpm prod:check
```

The remote tool list should include recent tools such as `mark_task_in_progress` and `dispatch_notifications`. If they are missing, Vercel is serving an older deployment and needs a fresh deploy from the current code.
