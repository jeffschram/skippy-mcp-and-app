"use client";

/**
 * Agents hub → Usage: token consumption across harness sessions
 * (docs/token-efficiency.md lever 1 — you can't tune what you can't see).
 *
 * Data source: usageSummaryForViewer, which aggregates the normalized `usage`
 * totals the runner reports onto each finished chat turn and agent run. The
 * cached share is the headline health number: cache reads are the cheap
 * bucket, so a falling percentage flags sessions that rebuild context from
 * scratch.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { Gauge } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { Badge, Card, EmptyState, LoadingRow, Select } from "../components";
import { mutedClass } from "../page-classes";
import { useViewerReady } from "./use-viewer";
import { cachedSharePercent, formatTokens, type UsageTotals } from "./agent-usage-helpers";

type UsageDay = { day: string; chat: UsageTotals; runs: UsageTotals; total: UsageTotals };
type UsageSummary = {
  days: number;
  counts: { chatTurns: number; runs: number };
  totals: { chat: UsageTotals; runs: UsageTotals; all: UsageTotals };
  byHarness: Record<string, UsageTotals>;
  byDay: UsageDay[];
};

const WINDOWS = [7, 30, 90];

function StatBlock({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div style={{ minWidth: 130 }}>
      <p className={mutedClass} style={{ margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 700 }}>{value}</p>
      {detail ? (
        <p className={mutedClass} style={{ margin: 0, fontSize: 12 }}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export function AgentUsageContent() {
  const viewerReady = useViewerReady();
  const [days, setDays] = useState(30);
  const summary = useQuery(api.agentWorkbench.usageSummaryForViewer, viewerReady ? { days } : "skip") as
    | UsageSummary
    | undefined;

  const cachedShare = cachedSharePercent(summary?.totals.all);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2>Token usage</h2>
          <p className={mutedClass} style={{ maxWidth: 640 }}>
            Tokens consumed by harness sessions the runner executed — chat turns and agent runs, both harnesses.
            Cached input is the cheap bucket; a high cached share means sessions are reusing context instead of
            rebuilding it.
          </p>
        </div>
        <Select value={String(days)} onChange={(event) => setDays(Number(event.target.value))}>
          {WINDOWS.map((window) => (
            <option key={window} value={window}>
              Last {window} days
            </option>
          ))}
        </Select>
      </div>

      {summary === undefined ? (
        <LoadingRow label="Loading usage..." />
      ) : summary.counts.chatTurns + summary.counts.runs === 0 ? (
        <EmptyState icon={<Gauge size={20} aria-hidden />} title="No usage recorded yet">
          Totals appear here after the next chat turn or agent run finishes on the runner (older sessions predate
          usage tracking).
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <StatBlock
              label="Total tokens"
              value={formatTokens(summary.totals.all.totalTokens)}
              detail={`${summary.counts.chatTurns} chat turns · ${summary.counts.runs} runs`}
            />
            <StatBlock label="Chat" value={formatTokens(summary.totals.chat.totalTokens)} />
            <StatBlock label="Task runs" value={formatTokens(summary.totals.runs.totalTokens)} />
            <StatBlock
              label="Cached input"
              value={cachedShare === undefined ? "—" : `${cachedShare}%`}
              detail={`${formatTokens(summary.totals.all.cachedInputTokens)} cached · ${formatTokens(summary.totals.all.inputTokens)} fresh`}
            />
            <StatBlock label="Output" value={formatTokens(summary.totals.all.outputTokens)} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(summary.byHarness).map(([harness, totals]) => (
              <Badge key={harness} tone="neutral">
                {harness}: {formatTokens(totals.totalTokens)}
              </Badge>
            ))}
          </div>

          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640, fontSize: 14 }}>
            <thead>
              <tr className={mutedClass} style={{ textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>Day (UTC)</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Chat</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Runs</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Cached</th>
                <th style={{ padding: "4px 0 4px 8px", fontWeight: 600 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.byDay.map((row) => (
                <tr key={row.day} style={{ textAlign: "right", borderTop: "1px solid var(--border, #2224)" }}>
                  <td style={{ textAlign: "left", padding: "4px 8px 4px 0" }}>{row.day}</td>
                  <td style={{ padding: "4px 8px" }}>{formatTokens(row.chat.totalTokens)}</td>
                  <td style={{ padding: "4px 8px" }}>{formatTokens(row.runs.totalTokens)}</td>
                  <td className={mutedClass} style={{ padding: "4px 8px" }}>
                    {cachedSharePercent(row.total) === undefined ? "—" : `${cachedSharePercent(row.total)}%`}
                  </td>
                  <td style={{ padding: "4px 0 4px 8px", fontWeight: 600 }}>{formatTokens(row.total.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
