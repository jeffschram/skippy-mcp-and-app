/**
 * Minimal, dependency-free inline-markdown tokenizer for short strings like focus bullets.
 * Supports: **bold**, *italic* / _italic_, `code`, and [text](url) links.
 * Pure (no JSX) so it can be unit-tested without a React transform.
 */

export type InlineToken =
  | { type: "text" | "bold" | "italic" | "code"; value: string }
  | { type: "link"; value: string; href: string };

// Ordered so longer/greedier markers win (e.g. ** before *).
const RULES: Array<{ type: InlineToken["type"]; regex: RegExp }> = [
  { type: "code", regex: /`([^`]+)`/y },
  { type: "bold", regex: /\*\*([^*]+)\*\*/y },
  { type: "bold", regex: /__([^_]+)__/y },
  { type: "italic", regex: /\*([^*]+)\*/y },
  { type: "italic", regex: /_([^_]+)_/y },
  { type: "link", regex: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/y },
];

function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function tokenizeInlineMarkdown(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (cursor < input.length) {
    let matched = false;
    for (const rule of RULES) {
      rule.regex.lastIndex = cursor;
      const match = rule.regex.exec(input);
      if (match) {
        flush();
        if (rule.type === "link") {
          const href = match[2] ?? "";
          if (isSafeHref(href)) {
            tokens.push({ type: "link", value: match[1] ?? "", href });
          } else {
            tokens.push({ type: "text", value: match[0] });
          }
        } else {
          tokens.push({ type: rule.type, value: match[1] ?? "" });
        }
        cursor = rule.regex.lastIndex;
        matched = true;
        break;
      }
    }
    if (!matched) {
      buffer += input[cursor];
      cursor += 1;
    }
  }
  flush();
  return tokens;
}
