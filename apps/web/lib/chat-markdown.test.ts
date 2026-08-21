// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "./chat-markdown";

/** Render a chat message to static HTML the way the transcript does. */
function render(content: string): string {
  return renderToStaticMarkup(createElement(ChatMarkdown, { children: content }));
}

describe("ChatMarkdown", () => {
  it("renders bold, italic, and headers", () => {
    const html = render("## Status\n\nAll **done** and _shipped_.");
    expect(html).toContain("<h2");
    expect(html).toContain("Status</h2>");
    expect(html).toContain("<strong>done</strong>");
    expect(html).toContain("<em>shipped</em>");
    // No literal markdown markers leak through.
    expect(html).not.toContain("**");
    expect(html).not.toContain("##");
  });

  it("renders lists", () => {
    const html = render("- one\n- two\n\n1. first\n2. second");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect((html.match(/<li/g) ?? []).length).toBe(4);
  });

  it("renders markdown links in a new tab with rel noopener", () => {
    const html = render("See [the PR](https://github.com/org/repo/pull/1).");
    expect(html).toContain('href="https://github.com/org/repo/pull/1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">the PR</a>");
  });

  it("auto-links bare URLs via GFM", () => {
    const html = render("PR opened: https://github.com/org/repo/pull/42");
    expect(html).toContain('<a href="https://github.com/org/repo/pull/42"');
    expect(html).toContain('target="_blank"');
  });

  it("neutralizes unsafe link protocols", () => {
    const html = render("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("renders inline and fenced code with mono styling", () => {
    const html = render("Run `pnpm test`.\n\n```ts\nconst x = 1;\n```");
    expect(html).toContain("font-mono");
    expect(html).toContain("pnpm test</code>");
    expect(html).toContain("<pre");
    expect(html).toContain("const x = 1;");
  });

  it("renders images constrained to the bubble width", () => {
    const html = render("![diagram](https://example.com/pic.png)");
    expect(html).toContain('src="https://example.com/pic.png"');
    expect(html).toContain('alt="diagram"');
    expect(html).toContain("max-w-full");
    expect(html).toContain("max-h-72");
  });

  it("does not render raw HTML as HTML", () => {
    const html = render('Hi <b>bold</b> <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    // The onerror payload survives only as escaped text, never as a real
    // <img> element/attribute.
    expect(html).not.toContain("<img");
    // The tags survive as visible, escaped text — historical messages that
    // mention angle-bracket content still read the same.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
  });

  it("keeps historical plain-text messages intact, including single newlines", () => {
    const html = render("Done with the sync.\nNothing needed from you today.");
    expect(html).toContain("Done with the sync.");
    expect(html).toContain("Nothing needed from you today.");
    // remark-breaks preserves the old whitespace-pre-wrap line break behavior.
    expect(html).toContain("<br/>");
  });

  it("renders plain text without inventing any formatting", () => {
    const html = render("just a normal sentence with 2 * 3 math.");
    expect(html).toContain("just a normal sentence with 2 * 3 math.");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<strong>");
  });
});
