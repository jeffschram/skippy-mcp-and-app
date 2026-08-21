import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "./utils";

/**
 * Centralized markdown renderer for chat transcripts.
 *
 * Assistant replies arrive as markdown; user messages are usually plain text.
 * Both flow through here so links, formatting, and code render consistently:
 * - GFM autolinks make bare URLs clickable; all links open in a new tab.
 * - remark-breaks keeps single newlines as line breaks, so historical
 *   plain-text messages render exactly as they did under whitespace-pre-wrap.
 * - Raw HTML is never rendered as HTML — react-markdown (without rehype-raw)
 *   escapes it to literal text, and defaultUrlTransform drops unsafe hrefs
 *   like javascript: URLs.
 *
 * Spacing is deliberately compact (chat density): paragraphs and blocks get
 * small vertical margins with first/last trimmed so bubbles hug their text.
 */

const BLOCK = "my-1.5 first:mt-0 last:mb-0";

const components: Components = {
  p: ({ node: _node, className, ...props }) => (
    <p {...props} className={cn("my-1 first:mt-0 last:mb-0", className)} />
  ),
  a: ({ node: _node, className, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-semibold underline underline-offset-2 [overflow-wrap:anywhere]", className)}
    />
  ),
  img: ({ node: _node, className, alt, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary chat-provided URL, not optimizable
    <img
      {...props}
      alt={alt ?? ""}
      loading="lazy"
      className={cn("my-1.5 max-h-72 max-w-full rounded-lg border object-contain", className)}
    />
  ),
  h1: ({ node: _node, className, ...props }) => (
    <h1 {...props} className={cn(BLOCK, "mt-3 text-base font-bold", className)} />
  ),
  h2: ({ node: _node, className, ...props }) => (
    <h2 {...props} className={cn(BLOCK, "mt-3 text-[15px] font-bold", className)} />
  ),
  h3: ({ node: _node, className, ...props }) => (
    <h3 {...props} className={cn(BLOCK, "mt-2 text-sm font-bold", className)} />
  ),
  h4: ({ node: _node, className, ...props }) => (
    <h4 {...props} className={cn(BLOCK, "mt-2 text-sm font-bold", className)} />
  ),
  h5: ({ node: _node, className, ...props }) => (
    <h5 {...props} className={cn(BLOCK, "mt-2 text-sm font-bold", className)} />
  ),
  h6: ({ node: _node, className, ...props }) => (
    <h6 {...props} className={cn(BLOCK, "mt-2 text-sm font-bold", className)} />
  ),
  ul: ({ node: _node, className, ...props }) => (
    <ul {...props} className={cn(BLOCK, "grid list-disc gap-0.5 pl-5", className)} />
  ),
  ol: ({ node: _node, className, ...props }) => (
    <ol {...props} className={cn(BLOCK, "grid list-decimal gap-0.5 pl-5", className)} />
  ),
  li: ({ node: _node, className, ...props }) => (
    <li {...props} className={cn("[overflow-wrap:anywhere]", className)} />
  ),
  blockquote: ({ node: _node, className, ...props }) => (
    <blockquote {...props} className={cn(BLOCK, "border-l-2 pl-3 text-muted-foreground", className)} />
  ),
  hr: ({ node: _node, className, ...props }) => (
    <hr {...props} className={cn("my-2 border-border", className)} />
  ),
  // Inline code: mono on a muted chip. Fenced code lives inside `pre`, which
  // resets the chip styling on its child so blocks stay a single clean panel.
  code: ({ node: _node, className, ...props }) => (
    <code
      {...props}
      className={cn("rounded bg-secondary px-1 py-0.5 font-mono text-[13px] [overflow-wrap:anywhere]", className)}
    />
  ),
  pre: ({ node: _node, className, ...props }) => (
    <pre
      {...props}
      className={cn(
        BLOCK,
        "overflow-x-auto rounded-lg border bg-secondary p-3 font-mono text-[13px] leading-snug",
        "[&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0",
        className,
      )}
    />
  ),
  table: ({ node: _node, className, ...props }) => (
    <div className={cn(BLOCK, "overflow-x-auto")}>
      <table {...props} className={cn("border-collapse text-xs", className)} />
    </div>
  ),
  th: ({ node: _node, className, ...props }) => (
    <th {...props} className={cn("border bg-secondary px-2 py-1 text-left font-bold", className)} />
  ),
  td: ({ node: _node, className, ...props }) => (
    <td {...props} className={cn("border px-2 py-1 align-top", className)} />
  ),
};

/**
 * Renders chat message content as sanitized markdown. Typography (text size,
 * line height, color) inherits from the wrapping element, so the same
 * component works inside user bubbles and assistant transcript blocks.
 */
export function ChatMarkdown({ children, className }: { children: string; className?: string | undefined }) {
  return (
    <div className={cn("min-w-0 [overflow-wrap:anywhere]", className)}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
