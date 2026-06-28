import { describe, expect, it } from "vitest";
import { tokenizeInlineMarkdown } from "./inline-markdown";

describe("tokenizeInlineMarkdown", () => {
  it("parses bold, italic, and code", () => {
    expect(tokenizeInlineMarkdown("Pay **the bill** now")).toEqual([
      { type: "text", value: "Pay " },
      { type: "bold", value: "the bill" },
      { type: "text", value: " now" },
    ]);
    expect(tokenizeInlineMarkdown("a *soft* `x` end")).toEqual([
      { type: "text", value: "a " },
      { type: "italic", value: "soft" },
      { type: "text", value: " " },
      { type: "code", value: "x" },
      { type: "text", value: " end" },
    ]);
  });

  it("parses underscore variants", () => {
    expect(tokenizeInlineMarkdown("__strong__ and _em_")).toEqual([
      { type: "bold", value: "strong" },
      { type: "text", value: " and " },
      { type: "italic", value: "em" },
    ]);
  });

  it("parses safe links and keeps unsafe ones as text", () => {
    expect(tokenizeInlineMarkdown("see [docs](https://example.com/x)")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "docs", href: "https://example.com/x" },
    ]);
    // javascript: and other schemes are not matched as links — rendered literally.
    expect(tokenizeInlineMarkdown("[x](javascript:alert(1))")).toEqual([
      { type: "text", value: "[x](javascript:alert(1))" },
    ]);
  });

  it("leaves plain text untouched", () => {
    expect(tokenizeInlineMarkdown("just a normal sentence.")).toEqual([
      { type: "text", value: "just a normal sentence." },
    ]);
  });
});
