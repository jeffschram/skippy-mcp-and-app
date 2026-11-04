"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { PendingActionItem } from "../live-pages";
export default function ChatPendingActions() {
  const actions = useQuery(api.knowledge.pendingActionsForViewer, { scope: "open" });
  const review = useMutation(api.knowledge.reviewPendingActionForViewer);
  const pending = actions?.filter(action => ["drafted", "pending_approval", "failed"].includes(action.status)) ?? [];
  if (!pending.length) return null;
  return <details className="max-h-64 overflow-y-auto border-t p-3" open><summary className="cursor-pointer text-sm font-medium">Actions awaiting your permission ({pending.length})</summary><div className="mt-2 grid gap-2">{pending.map(action => <PendingActionItem key={action._id} action={action} reviewPendingAction={args => review(args as any)} />)}</div></details>;
}
