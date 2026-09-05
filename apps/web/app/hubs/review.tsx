"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { LiveGate } from "../live-auth";
import {
  isReviewQueueFilter,
  LiveApprovalHistoryContent,
  LiveReviewQueueContent,
  type ReviewQueueFilter,
} from "../live-pages";
import {
  eyebrowClass,
  mutedClass,
  pageHeaderClass,
  textButtonClass,
  textButtonCompactClass,
} from "../page-classes";

// One page, one queue (owner decision Sep 4, ui-ux-improvement-plan.md): the
// Signals/Actions/Routines tabs are gone. Approvals pin to the top, Finds
// (including the old Brain Inbox) follow, Revisit sits at the bottom, and
// filter chips replace tab-to-tab navigation. ?filter= lets Home deep-link
// into the queue with a chip pre-selected.
export function ReviewContent() {
  const searchParams = useSearchParams();
  const filterParam = searchParams?.get("filter");
  const initialFilter: ReviewQueueFilter = isReviewQueueFilter(filterParam) ? filterParam : "all";

  return (
    <LiveGate>
      <div className={pageHeaderClass}>
        <div>
          <p className={eyebrowClass}>Review queue</p>
          <h1>One place to decide.</h1>
          <p className={`${mutedClass} max-w-[560px]`}>
            Everything waiting on you, in one list — highest stakes first. Nothing changes until you say so.
          </p>
        </div>
        {/* Quiet, top-right: settled approvals live here, not in the queue. */}
        <Link className={cn(textButtonClass, textButtonCompactClass)} href="/review/history">
          History ›
        </Link>
      </div>

      {/* Remount when the deep-linked filter changes so a fresh navigation from
          Home always lands on the requested chip. */}
      <LiveReviewQueueContent key={initialFilter} initialFilter={initialFilter} />
    </LiveGate>
  );
}

export function ReviewHistoryContent() {
  return (
    <LiveGate>
      <div className={pageHeaderClass}>
        <div>
          <p className={eyebrowClass}>Review · History</p>
          <h1>Settled approvals.</h1>
          <p className={`${mutedClass} max-w-[560px]`}>
            Everything you already approved or rejected. The queue only ever shows open decisions.
          </p>
        </div>
        <Link className={cn(textButtonClass, textButtonCompactClass)} href="/review">
          ‹ Back to the queue
        </Link>
      </div>

      <LiveApprovalHistoryContent />
    </LiveGate>
  );
}
