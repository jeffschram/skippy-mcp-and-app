import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "./utils";

/**
 * Centralized markdown renderer shared by the chat transcript and the Task
 * Detail panel.
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
 * Two spacing variants share the exact same element treatment and
 * sanitization; only vertical rhythm differs:
 * - "chat" (default): compact chat density — small margins with first/last
 *   trimmed so bubbles hug their text.
 * - "document": a reading surface (task descriptions, execution briefs,
 *   result summaries) — slightly roomier paragraph/list spacing and heading
 *   separation for long-form content.
 */

type MarkdownVariant = "chat" | "document";

/** Per-variant vertical rhythm. Everything else is identical across variants. */
const SPACING: Record<
  MarkdownVariant,
  { block: string; p: string; hTop: string; hTopSm: string; listGap: string }
> = {
  chat: { block: "my-1.5", p: "my-1", hTop: "mt-3", hTopSm: "mt-2", listGap: "gap-0.5" },
  document: { block: "my-2.5", p: "my-2", hTop: "mt-4", hTopSm: "mt-3", listGap: "gap-1" },
};

/** Links always open in a new tab; identical in every variant and inline. */
const linkComponent: NonNullable<Components["a"]> = ({ node: _node, className, ...props }) => (
  <a
    {...props}
    target="_blank"
    rel="noopener noreferrer"
    className={cn("font-semibold underline underline-offset-2 [overflow-wrap:anywhere]", className)}
  />
);

// Inline code: mono on a muted chip. Fenced code lives inside `pre`, which
// resets the chip styling on its child so blocks stay a single clean panel.
const codeComponent: NonNullable<Components["code"]> = ({ node: _node, className, ...props }) => (
  <code
    {...props}
    className={cn("rounded bg-secondary px-1 py-0.5 font-mono text-[13px] [overflow-wrap:anywhere]", className)}
  />
);

function buildComponents(variant: MarkdownVariant): Components {
  const spacing = SPACING[variant];
  const BLOCK = cn(spacing.block, "first:mt-0 last:mb-0");
  return {
    p: ({ node: _node, className, ...props }) => (
      <p {...props} className={cn(spacing.p, "first:mt-0 last:mb-0", className)} />
    ),
    a: linkComponent,
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
      <h1 {...props} className={cn(BLOCK, spacing.hTop, "text-base font-bold", className)} />
    ),
    h2: ({ node: _node, className, ...props }) => (
      <h2 {...props} className={cn(BLOCK, spacing.hTop, "text-[15px] font-bold", className)} />
    ),
    h3: ({ node: _node, className, ...props }) => (
      <h3 {...props} className={cn(BLOCK, spacing.hTopSm, "text-sm font-bold", className)} />
    ),
    h4: ({ node: _node, className, ...props }) => (
      <h4 {...props} className={cn(BLOCK, spacing.hTopSm, "text-sm font-bold", className)} />
    ),
    h5: ({ node: _node, className, ...props }) => (
      <h5 {...props} className={cn(BLOCK, spacing.hTopSm, "text-sm font-bold", className)} />
    ),
    h6: ({ node: _node, className, ...props }) => (
      <h6 {...props} className={cn(BLOCK, spacing.hTopSm, "text-sm font-bold", className)} />
    ),
    ul: ({ node: _node, className, ...props }) => (
      <ul {...props} className={cn(BLOCK, "grid list-disc pl-5", spacing.listGap, className)} />
    ),
    ol: ({ node: _node, className, ...props }) => (
      <ol {...props} className={cn(BLOCK, "grid list-decimal pl-5", spacing.listGap, className)} />
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
    code: codeComponent,
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
}

// Built once per variant so react-markdown sees stable component identities.
const COMPONENTS: Record<MarkdownVariant, Components> = {
  chat: buildComponents("chat"),
  document: buildComponents("document"),
};

/**
 * Renders markdown content sanitized, with variant-appropriate spacing.
 * Typography (text size, line height, color) inherits from the wrapping
 * element, so the same component works inside chat bubbles, assistant
 * transcript blocks, and the Task Detail panel's reading sections.
 */
export function ChatMarkdown({
  children,
  className,
  variant = "chat",
}: {
  children: string;
  className?: string | undefined;
  variant?: MarkdownVariant | undefined;
}) {
  return (
    <div className={cn("min-w-0 [overflow-wrap:anywhere]", className)}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS[variant]}>
        {children}
      </Markdown>
    </div>
  );
}

/**
 * Block-level markdown is stripped (unwrapped to its text) so callers keep
 * full control of surrounding chrome — e.g. acceptance-criteria list items
 * keep the panel's own bullet styling while `code`, **bold**, and [links]
 * still render. Sanitization is identical to ChatMarkdown: raw HTML is
 * escaped to text and unsafe hrefs are dropped.
 */
const INLINE_DISALLOWED = [
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
];

const inlineComponents: Components = {
  a: linkComponent,
  code: codeComponent,
};

/** Renders only the inline markdown of a string (code spans, bold, links). */
export function ChatMarkdownInline({
  children,
  className,
}: {
  children: string;
  className?: string | undefined;
}) {
  return (
    <span className={cn("[overflow-wrap:anywhere]", className)}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        disallowedElements={INLINE_DISALLOWED}
        unwrapDisallowed
        components={inlineComponents}
      >
        {children}
      </Markdown>
    </span>
  );
}
