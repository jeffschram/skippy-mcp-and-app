import { describe, expect, it } from "vitest";
import {
  CHAT_HISTORY_MESSAGE_LIMIT,
  chatHistoryWindow,
  shouldRefreshHistorySummary,
  summarizableMessageCount,
} from "./chat-history-helpers";

describe("chat history window", () => {
  it("retains only the settled 30-message recent window", () => {
    const messages = Array.from({ length: 45 }, (_, index) => index + 1);
    expect(chatHistoryWindow(messages)).toEqual(messages.slice(-CHAT_HISTORY_MESSAGE_LIMIT));
  });

  it("leaves short histories intact", () => {
    expect(chatHistoryWindow([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("chat history summary high-water math", () => {
  it("waits for ten older unsummarized messages", () => {
    expect(shouldRefreshHistorySummary(39, 0)).toBe(false);
    expect(shouldRefreshHistorySummary(40, 0)).toBe(true);
    expect(summarizableMessageCount(40)).toBe(10);
  });

  it("refreshes in batches relative to the stored high-water mark", () => {
    expect(shouldRefreshHistorySummary(49, 10)).toBe(false);
    expect(shouldRefreshHistorySummary(50, 10)).toBe(true);
    expect(shouldRefreshHistorySummary(100, 70)).toBe(false);
  });
});
