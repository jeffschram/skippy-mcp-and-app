import type { ReactNode } from "react";
import { tokenizeInlineMarkdown } from "./inline-markdown";

/**
 * Renders short inline markdown (bold, italic, code, links) as React nodes.
 * Block-level markdown is not handled; bullet markers are stripped upstream in focus-summary.ts.
 */
export function InlineMarkdown({ children }: { children: string }): ReactNode {
  const tokens = tokenizeInlineMarkdown(children);
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "bold":
            return <strong key={index}>{token.value}</strong>;
          case "italic":
            return <em key={index}>{token.value}</em>;
          case "code":
            return (
              <code key={index} className="code">
                {token.value}
              </code>
            );
          case "link":
            return (
              <a key={index} href={token.href} target="_blank" rel="noopener noreferrer">
                {token.value}
              </a>
            );
          default:
            return <span key={index}>{token.value}</span>;
        }
      })}
    </>
  );
}
