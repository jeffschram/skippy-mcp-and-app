/**
 * Pure scroll-position logic for the chat transcript.
 *
 * Two independent questions, answered from the same metrics snapshot:
 *
 * 1. Is the view "pinned" to the bottom? While pinned, new messages keep the
 *    transcript glued to the latest content; once the user scrolls up to read
 *    history, incoming messages must never yank the position back down.
 *    A small slack keeps sub-pixel rounding and near-bottom drift counting
 *    as pinned.
 *
 * 2. Has the user scrolled far enough up that a jump-to-bottom affordance is
 *    worth showing? Threshold is ~one viewport height — closer than that and
 *    the bottom is a flick away, so the button would be noise.
 */

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** Slack (px) within which the view still counts as pinned to the bottom. */
export const PINNED_SLACK_PX = 48;

/** How many pixels of content sit below the viewport's bottom edge. */
export function distanceFromBottom({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

/** True while the view should auto-follow new messages. */
export function isPinnedToBottom(metrics: ScrollMetrics, slackPx: number = PINNED_SLACK_PX): boolean {
  return distanceFromBottom(metrics) <= slackPx;
}

/**
 * True when the user is scrolled up beyond ~one viewport height and the
 * jump-to-bottom button should appear. The floor guards degenerate layouts
 * (zero/near-zero clientHeight before first paint) from flashing the button.
 */
export function shouldShowJumpToBottom(metrics: ScrollMetrics): boolean {
  return distanceFromBottom(metrics) > Math.max(metrics.clientHeight, PINNED_SLACK_PX * 2);
}
