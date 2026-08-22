// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown, ChatMarkdownInline } from "./chat-markdown";

/** Render a chat message to static HTML the way the transcript does. */
function render(content: string): string {
  return renderToStaticMarkup(createElement(ChatMarkdown, { children: content }));
}

/** Render with the roomier document variant, the way the task panel does. */
function renderDocument(content: string): string {
  return renderToStaticMarkup(
    createElement(ChatMarkdown, { children: content, variant: "document" }),
  );
}

/** Render inline-only markdown, the way acceptance criteria items do. */
function renderInline(content: string): string {
  return renderToStaticMarkup(createElement(ChatMarkdownInline, { children: content }));
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

describe("ChatMarkdown document variant", () => {
  it("uses roomier spacing than chat while keeping identical structure", () => {
    const source = "## Plan\n\nFirst paragraph.\n\nSecond paragraph.";
    const chat = render(source);
    const doc = renderDocument(source);
    // Same markup shape either way — only the spacing classes differ.
    expect(doc).toContain("<h2");
    expect(doc).toContain("Plan</h2>");
    expect(chat).toContain('class="my-1 first:mt-0 last:mb-0"');
    expect(doc).toContain('class="my-2 first:mt-0 last:mb-0"');
    expect(doc).not.toContain("my-1 first:mt-0");
  });

  it("sanitizes identically to chat: no raw HTML, no unsafe hrefs", () => {
    const html = renderDocument("Brief with <script>alert(1)</script> inline.");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    // Unsafe link protocols are dropped from the rendered anchor.
    const link = renderDocument("[click](javascript:alert(1))");
    expect(link).not.toContain('href="javascript:');
    expect(link).toContain(">click</a>");
  });

  it("opens links in a new tab, keeps code blocks mono on muted background", () => {
    const html = renderDocument(
      "See https://github.com/org/repo/pull/9\n\n```sh\npnpm test\n```",
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<pre");
    // Narrow-panel safety: fenced code scrolls horizontally instead of
    // widening the layout.
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("bg-secondary");
    expect(html).toContain("font-mono");
  });

  it("keeps historical plain-text briefs intact, including single newlines", () => {
    const html = renderDocument("Step one.\nStep two, same paragraph.");
    expect(html).toContain("Step one.");
    expect(html).toContain("Step two, same paragraph.");
    expect(html).toContain("<br/>");
  });
});

describe("ChatMarkdownInline", () => {
  it("renders code spans, bold, and links without any block wrappers", () => {
    const html = renderInline("Run `pnpm test` and see **green** in [CI](https://ci.example.com)");
    expect(html).toContain("pnpm test</code>");
    expect(html).toContain("<strong>green</strong>");
    expect(html).toContain('href="https://ci.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // No block markup: the caller (e.g. the criteria <li>) owns the chrome.
    expect(html).not.toContain("<p");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<li");
    expect(html).not.toContain("<h");
  });

  it("unwraps block syntax to plain inline content instead of emitting lists", () => {
    // A criterion that happens to start with list syntax must not produce
    // nested list markup inside the panel's own bullet.
    const html = renderInline("- tests pass with `pnpm test`");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<li");
    expect(html).toContain("tests pass");
    expect(html).toContain("pnpm test</code>");
  });

  it("keeps plain-text criteria unchanged and never renders raw HTML", () => {
    const html = renderInline("Panel width stays fixed <b>always</b>");
    expect(html).toContain("Panel width stays fixed");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<em>");
  });

  it("auto-links bare PR URLs", () => {
    const html = renderInline("PR merged: https://github.com/org/repo/pull/7");
    expect(html).toContain('<a href="https://github.com/org/repo/pull/7"');
    expect(html).toContain('target="_blank"');
  });
});
