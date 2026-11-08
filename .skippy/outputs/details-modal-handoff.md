# Details modal implementation

Implemented a reusable ItemDetailsModal for task, event and recurrence rows across Today, This Week and All. It loads the selected canonical owned record through a reactive Convex query, independently of inventory filters. Details include descriptions, status, dates, time zone, all-day semantics, location, source links and recurrence context.

The neutral ItemDetailsChat wrapper reuses Mind's ChatSurface and preserves `mind-item:<canonical ID>` conversation keys, so Home and Mind share existing transcripts. Its React key includes type and ID; changing selection remounts drafts, subscriptions and asynchronous UI state. Server context refreshes on every turn and now includes recurrence scheduling context. Missing/deleted/inaccessible items unmount chat. Existing send-time ownership validation remains in place.

The Radix modal supplies focus trapping and Escape; initial focus goes to its heading, closing restores the original opener or the Home section. It includes a visible close control, viewport-bounded responsive layout, safe-area composer padding, loading/unavailable/error-retry states, and existing hash/popstate deep-link behavior. Row actions remain separate native buttons. Calendar capture links now open event details.

Verification:
- Shared, AI and MCP server dependency builds passed.
- Web TypeScript check passed.
- Convex TypeScript check passed.
- Existing web suite: 379 tests passed (37 files).
- New modal rendering tests: 2 passed; final targeted modal, hash and chat regression run: 27 passed (4 files).
- Convex inventory/context tests: 16 passed (3 files), including ownership, wrong-kind lookup, deletion, canonical identity, fresh context, recurrence context and source isolation.
- `git diff --check` passed.

Not verified in a live authenticated browser: actual focus cycling/restoration, browser Back while changing selections, narrow-screen layout and virtual-keyboard behavior, or streaming chat while switching items. Automated UI tests use server rendering with mocked queries/chat, not a browser interaction harness. No messages were sent and no live calendars were changed.

No push, merge or deployment was performed.
