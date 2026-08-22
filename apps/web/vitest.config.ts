import { defineConfig } from "vitest/config";

// Next.js sets tsconfig `jsx: "preserve"`, which vite/vitest can't execute —
// emit the automatic runtime instead so .tsx components
// (e.g. lib/chat-markdown.tsx) are testable.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});
