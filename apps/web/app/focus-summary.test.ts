import { describe, expect, it } from "vitest";
import { focusSummaryPresentation, isActionableFocusItem, parseFocusSummary } from "./focus-summary";

describe("focus summary presentation", () => {
  it("filters standing context out of the Now action list", () => {
    const summary = focusSummaryPresentation([
      "Today: primary context.",
      "Use **Jeff Schram** as the ongoing owner context (front-end/UI/UX, design systems/Figma, creative tech/music).",
      "Treat **Matt Blanchard**, **Mazin Melegy**, and **Shae Tabatt** as high-signal work leadership/PM contacts.",
      "Continue support for **Holly Danger / Danger Gallery**.",
    ]);

    expect(summary).toEqual({
      heading: "Nothing new needs focus right now.",
      details: [],
    });
  });

  it("keeps concrete next moves actionable", () => {
    const summary = focusSummaryPresentation([
      "Today: Skippy build.",
      "Keep **Skippy MCP & App** moving; monitor **Vercel/GitHub PR #5** preview build/deployment status.",
      "Review today's calendar for prep needs.",
      "Pay the card statement before the deadline.",
    ]);

    expect(summary.heading).toBe("Today: finance, Skippy build, and calendar.");
    expect(summary.details).toHaveLength(3);
    expect(summary.details[0]).toContain("monitor");
  });

  it("summarizes multiple same-category bullets instead of promoting the first bullet", () => {
    const summary = focusSummaryPresentation([
      "Deploy the Skippy MCP server updates.",
      "Review the GitHub preview build for the Skippy web app.",
      "Fix the Convex task owner type migration.",
    ]);

    expect(summary.heading).toBe("Today: Skippy build priorities.");
    expect(summary.details).toHaveLength(3);
  });

  it("summarizes uncategorized bullets by count", () => {
    const summary = focusSummaryPresentation([
      "Resolve the customer support handoff.",
      "Prepare notes for tomorrow's planning session.",
    ]);

    expect(summary.heading).toBe("Today: 2 priorities need attention.");
    expect(summary.details).toHaveLength(2);
  });

  it("classifies the confusing context prompt as non-actionable", () => {
    expect(isActionableFocusItem("Use **Jeff Schram** as the ongoing owner context.")).toBe(false);
    expect(isActionableFocusItem("Monitor **Vercel/GitHub PR #5** preview build/deployment status.")).toBe(true);
  });

  it("preserves markdown email links in parsed bullets", () => {
    const { headline, bullets } = parseFocusSummary(
      [
        "Summary: Reply to the outstanding statement email.",
        "- Reply to [Chase statement](https://mail.google.com/mail/u/0/#all/18f2c3a) before Friday.",
        "- Review today's calendar for prep needs.",
      ].join("\n"),
    );

    expect(headline).toBe("Reply to the outstanding statement email.");
    expect(bullets[0]).toBe("Reply to [Chase statement](https://mail.google.com/mail/u/0/#all/18f2c3a) before Friday.");
  });
});
