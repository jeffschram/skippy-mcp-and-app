/**
 * Keep enough verbatim context for recent decisions without making a fresh
 * harness thread replay the full lifetime of a marathon chat.
 */
export const CHAT_HISTORY_MESSAGE_LIMIT = 30;

/** Avoid paying for a new rolling summary after every assistant response. */
export const CHAT_HISTORY_SUMMARY_MARGIN = 10;

export function chatHistoryWindow<T>(messages: readonly T[], limit = CHAT_HISTORY_MESSAGE_LIMIT): T[] {
  return messages.slice(-limit);
}

/** Number of complete messages that can be represented by the rolling summary. */
export function summarizableMessageCount(
  completeMessageCount: number,
  limit = CHAT_HISTORY_MESSAGE_LIMIT,
): number {
  return Math.max(0, completeMessageCount - limit);
}

export function shouldRefreshHistorySummary(
  completeMessageCount: number,
  summarizedThroughMessageCount: number,
  limit = CHAT_HISTORY_MESSAGE_LIMIT,
  margin = CHAT_HISTORY_SUMMARY_MARGIN,
): boolean {
  return summarizableMessageCount(completeMessageCount, limit) - summarizedThroughMessageCount >= margin;
}
