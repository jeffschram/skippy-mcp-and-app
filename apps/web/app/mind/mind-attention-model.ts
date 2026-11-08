import type { AgendaItem } from "@skippy/shared";
import type { AttentionKind, AttentionResult } from "../../../../convex/attentionModel";

export type FocusItem = { id: string; kind: AttentionKind; title: string; result: AttentionResult };
export type FeedRow = { key: string; title: string; reason: string; group: "needs" | "today" | "review" | "next"; entityId?: string | undefined; focus?: FocusItem; agenda?: AgendaItem };
export function todayRange(now: number) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.getTime(), to: end.getTime() - 1 };
}
