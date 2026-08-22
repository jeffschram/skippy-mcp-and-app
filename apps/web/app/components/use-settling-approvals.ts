"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AnyRecord = Record<string, any>;

/** How long a just-settled card stays mounted to play its exit animation. */
export const APPROVAL_SETTLE_EXIT_MS = 350;

/**
 * Live approval surfaces (task panel stack, chat transcript) show pending
 * approvals only: once decided, the card disappears — the decision's durable
 * record lives in run/task activity history, not the conversation surface
 * (owner decision, superseding PR #117's lingering settled chips).
 *
 * The approvalsForProjectForViewer query still returns settled approvals
 * (history may want them later), so this hook is where the render-side
 * filtering happens. An approval that settles *while mounted* lingers for
 * APPROVAL_SETTLE_EXIT_MS with its id in `leavingIds` so the consumer can
 * play a brief fade/collapse (gated with motion-reduce so reduced-motion
 * users just see it removed). Approvals that arrive already settled never
 * render at all.
 */
export function useSettlingApprovals(approvals: AnyRecord[]): {
  approvals: AnyRecord[];
  leavingIds: ReadonlySet<string>;
} {
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Ids this hook has seen pending; only those animate out on settle.
  const pendingSeenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const seen = pendingSeenRef.current;
    const settledNow: string[] = [];
    for (const approval of approvals) {
      const id = String(approval._id);
      if (approval.status === "pending") seen.add(id);
      else if (seen.delete(id)) settledNow.push(id);
    }
    if (!settledNow.length) return;
    setLeavingIds((current) => new Set([...current, ...settledNow]));
    const timer = window.setTimeout(() => {
      setLeavingIds((current) => {
        const next = new Set(current);
        for (const id of settledNow) next.delete(id);
        return next;
      });
    }, APPROVAL_SETTLE_EXIT_MS);
    timersRef.current.push(timer);
  }, [approvals]);

  // Drop any in-flight exit timers when the surface unmounts.
  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  const visible = useMemo(
    () =>
      approvals.filter(
        (approval) =>
          approval.status === "pending" ||
          leavingIds.has(String(approval._id)),
      ),
    [approvals, leavingIds],
  );

  return { approvals: visible, leavingIds };
}
