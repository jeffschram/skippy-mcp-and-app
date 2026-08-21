"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, GitBranch, PanelRight, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import {
  approvalDetailText,
  approvalKindLabel,
  approvalStatusChip,
  approvalSummaryLine,
} from "../../lib/approvals";
import { Badge, Button } from "./ui";
import { useToast } from "./widgets";

type AnyRecord = Record<string, any>;

/**
 * One approval, one component, two scales. The panel variant is the rich
 * card (kind badge, monospace command/diffStat, push extras, full-width
 * decision buttons); the chat variant is a compact actionable notice at
 * chat typography. Both share this decision path — decideApprovalForViewer,
 * idempotent server-side — so the surfaces can never disagree on behavior.
 * A settled approval renders in place as a chip: the record of the decision.
 */
export function ApprovalCard({
  approval,
  variant,
  onOpenTask,
  className,
}: {
  approval: AnyRecord;
  variant: "panel" | "chat";
  onOpenTask?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const decide = useMutation(api.agentWorkbench.decideApprovalForViewer);
  const toast = useToast();
  // Which decision is in flight, so only the clicked button spins.
  const [deciding, setDeciding] = useState<"accepted" | "declined" | null>(null);

  // Chat-turn approvals arrive without a status field (only pending ones are
  // returned); run approvals carry their full lifecycle status.
  const status: string = approval.status ?? "pending";
  const pending = status === "pending";
  const chip = approvalStatusChip(status);
  const decisions: string[] = approval.availableDecisions ?? [
    "accepted",
    "declined",
  ];

  const settle = async (decision: "accepted" | "declined") => {
    if (deciding) return;
    setDeciding(decision);
    try {
      await decide({ approvalId: approval._id, decision } as any);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not record decision",
        "error",
      );
    } finally {
      setDeciding(null);
    }
  };

  const kindLabel = approvalKindLabel(approval.kind);
  const detailText = approvalDetailText(approval);
  const isPush = approval.kind === "push" || approval.kind === "pr";
  const details: AnyRecord = approval.details ?? {};
  const branch: string =
    (typeof details.branch === "string" && details.branch) ||
    (typeof approval.branch === "string" && approval.branch) ||
    "";
  const verification: string =
    (typeof details.verification === "string" && details.verification) ||
    (typeof approval.verificationSummary === "string" &&
      approval.verificationSummary) ||
    "";

  if (variant === "chat") {
    return (
      <article
        className={cn(
          "w-full rounded-xl border px-3 py-2.5",
          pending ? "border-gold/70 bg-gold/[0.06]" : "border-border bg-background/40",
          className,
        )}
      >
        <div className="flex items-center gap-1.5 text-xs font-bold">
          <ShieldAlert
            size={14}
            aria-hidden
            className={cn("shrink-0", pending ? "text-gold" : "text-muted-foreground")}
          />
          <span className={pending ? "text-gold" : "text-muted-foreground"}>
            {pending ? `${kindLabel} approval` : kindLabel}
          </span>
          {approval.taskTitle ? (
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
              {approval.taskTitle}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-foreground">
              {approval.title}
            </span>
          )}
          {chip ? <Badge tone={chip.tone}>{chip.label}</Badge> : null}
        </div>
        <p
          className={cn(
            "m-0 mt-1 truncate text-xs text-muted-foreground",
            approval.kind === "command" && "font-mono",
          )}
        >
          {approvalSummaryLine(approval)}
        </p>
        {pending || onOpenTask ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pending && decisions.includes("accepted") ? (
              <Button
                small
                variant="primary"
                disabled={deciding !== null}
                className={cn(deciding === "accepted" && "animate-pulse")}
                onClick={() => void settle("accepted")}
              >
                <Check size={13} aria-hidden /> Approve
              </Button>
            ) : null}
            {pending && decisions.includes("declined") ? (
              <Button
                small
                disabled={deciding !== null}
                className={cn(deciding === "declined" && "animate-pulse")}
                onClick={() => void settle("declined")}
              >
                <X size={13} aria-hidden /> Decline
              </Button>
            ) : null}
            {onOpenTask ? (
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"
                onClick={onOpenTask}
              >
                <PanelRight size={13} aria-hidden /> Details
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={cn(
        "rounded-xl border p-4",
        pending ? "border-gold bg-gold/[0.07]" : "border-border bg-background/40",
        className,
      )}
      aria-label={pending ? "Approval needed" : "Settled approval"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert
          size={16}
          aria-hidden
          className={pending ? "text-gold" : "text-muted-foreground"}
        />
        <span
          className={cn(
            "text-xs font-bold uppercase tracking-[0.08em]",
            pending ? "text-gold" : "text-muted-foreground",
          )}
        >
          {pending ? "Waiting on you" : "Approval"}
        </span>
        <Badge tone={pending ? "gold" : "neutral"}>{kindLabel}</Badge>
        {chip ? <Badge tone={chip.tone} className="ml-auto">{chip.label}</Badge> : null}
      </div>

      <h3 className="m-0 mt-2 text-[15px] font-semibold leading-snug">
        {approval.title}
      </h3>

      {isPush && branch ? (
        <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranch size={13} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate font-mono">{branch}</span>
        </p>
      ) : null}
      {isPush && verification ? (
        <p className="m-0 mt-1.5 text-xs text-muted-foreground">
          <span className="font-bold">Verification:</span> {verification}
        </p>
      ) : null}

      {detailText ? (
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background/70 p-2.5 font-mono text-xs leading-relaxed">
          {detailText}
        </pre>
      ) : null}

      {approval.explanation ? (
        <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {approval.explanation}
        </p>
      ) : null}
      {!pending && approval.reason ? (
        <p className="m-0 mt-2 text-xs text-muted-foreground">{approval.reason}</p>
      ) : null}

      {pending ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {decisions.includes("accepted") ? (
            <Button
              variant="primary"
              disabled={deciding !== null}
              className={cn(deciding === "accepted" && "animate-pulse")}
              onClick={() => void settle("accepted")}
            >
              <Check size={15} aria-hidden /> Approve
            </Button>
          ) : null}
          {decisions.includes("declined") ? (
            <Button
              disabled={deciding !== null}
              className={cn(deciding === "declined" && "animate-pulse")}
              onClick={() => void settle("declined")}
            >
              <X size={15} aria-hidden /> Decline
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
