import { nextAgentDueAt, type AgentSchedule } from "@skippy/shared";

export function agentPassRunId(configId: string, claimVersion: number) {
  return `agent-pass:${configId}:${claimVersion}`;
}

/** A successful process exit is not evidence of successful source ingestion. */
export function agendaOutcome(report: {
  runKey?: string; status: string; startedAt: number; completedAt?: number;
  errors?: string[]; metadata?: { role?: string };
} | null, runId: string, startedAt: number) {
  if (!report || report.runKey !== runId || report.startedAt < startedAt ||
      report.metadata?.role !== "agenda" || !report.completedAt) {
    return { status: "failed" as const, summary: "Agenda did not persist a terminal ingestion report for this attempt; inspect connector access and reporting." };
  }
  if (report.status !== "completed" || report.errors?.length) {
    return { status: "failed" as const, summary: "Agenda source coverage failed or is incomplete; inspect this attempt's ingestion report before retrying." };
  }
  return { status: "completed" as const, summary: "Agenda ingestion report confirms complete source coverage." };
}

/** Three persisted retries, then the next normal slot. Respect quiet hours. */
export function agendaRetry(schedule: AgentSchedule | undefined, enabled: boolean, status: string, retryCount: number, now: number) {
  if (!enabled || !schedule) return { retryCount: 0, nextDueAt: undefined };
  const delay = [1, 5, 15][retryCount];
  if (status === "failed" && delay !== undefined) {
    return { retryCount: retryCount + 1, nextDueAt: nextAgentDueAt({
      kind: "interval", everyMinutes: delay,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
      ...(schedule.kind === "interval" && schedule.window ? { window: schedule.window } : {}),
    }, now) };
  }
  return { retryCount: 0, nextDueAt: nextAgentDueAt(schedule, now) };
}
