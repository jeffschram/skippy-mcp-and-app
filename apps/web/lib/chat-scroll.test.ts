import { describe, expect, it } from "vitest";
import {
  PINNED_SLACK_PX,
  distanceFromBottom,
  isPinnedToBottom,
  shouldShowJumpToBottom,
} from "./chat-scroll";

describe("distanceFromBottom", () => {
  it("is zero when scrolled exactly to the bottom", () => {
    expect(distanceFromBottom({ scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 })).toBe(0);
  });

  it("measures the content hidden below the viewport", () => {
    expect(distanceFromBottom({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 500 })).toBe(500);
  });

  it("clamps to zero on sub-pixel overscroll past the bottom", () => {
    // Momentum scrolling / fractional scrollTop can overshoot scrollHeight.
    expect(distanceFromBottom({ scrollTop: 1500.5, scrollHeight: 2000, clientHeight: 500 })).toBe(0);
  });

  it("is zero when content fits without scrolling", () => {
    expect(distanceFromBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(0);
  });
});

describe("isPinnedToBottom", () => {
  it("is pinned at the exact bottom", () => {
    expect(isPinnedToBottom({ scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 })).toBe(true);
  });

  it("stays pinned within the slack band", () => {
    expect(
      isPinnedToBottom({ scrollTop: 1500 - PINNED_SLACK_PX, scrollHeight: 2000, clientHeight: 500 }),
    ).toBe(true);
  });

  it("unpins one pixel beyond the slack band", () => {
    expect(
      isPinnedToBottom({ scrollTop: 1500 - PINNED_SLACK_PX - 1, scrollHeight: 2000, clientHeight: 500 }),
    ).toBe(false);
  });

  it("is pinned when content fits without scrolling", () => {
    expect(isPinnedToBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(true);
  });

  it("honors a custom slack", () => {
    const metrics = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 500 };
    expect(isPinnedToBottom(metrics, 100)).toBe(true);
    expect(isPinnedToBottom(metrics, 99)).toBe(false);
  });
});

describe("shouldShowJumpToBottom", () => {
  it("stays hidden at the bottom", () => {
    expect(shouldShowJumpToBottom({ scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 })).toBe(false);
  });

  it("stays hidden within one viewport height of the bottom", () => {
    expect(shouldShowJumpToBottom({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 500 })).toBe(false);
  });

  it("shows once scrolled beyond one viewport height", () => {
    expect(shouldShowJumpToBottom({ scrollTop: 999, scrollHeight: 2000, clientHeight: 500 })).toBe(true);
  });

  it("stays hidden for short transcripts that cannot scroll far", () => {
    expect(shouldShowJumpToBottom({ scrollTop: 0, scrollHeight: 600, clientHeight: 500 })).toBe(false);
  });

  it("stays hidden before layout when clientHeight is zero", () => {
    // Pre-paint metrics: everything reads 0 — never flash the button.
    expect(shouldShowJumpToBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(false);
    // Degenerate tiny pane: the floor keeps small offsets from triggering it.
    expect(shouldShowJumpToBottom({ scrollTop: 0, scrollHeight: 90, clientHeight: 0 })).toBe(false);
  });
});
