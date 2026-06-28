import type { BadgeTone } from "../app/components/ui";

/** First non-empty string across candidate fields (data shapes vary by query). */
export function textValue(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function formatDate(value: unknown): string {
  if (value == null) return "";
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelative(value: unknown): string {
  if (value == null) return "";
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < 0) return formatDate(ms);
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 14 * day) return `${Math.round(diff / day)}d ago`;
  return formatDate(ms);
}

const TASK_STATUS_TONE: Record<string, BadgeTone> = {
  todo: "neutral",
  in_progress: "blue",
  waiting: "gold",
  done: "green",
  cancelled: "red",
};

const PROJECT_STATUS_TONE: Record<string, BadgeTone> = {
  idea: "neutral",
  planned: "blue",
  in_progress: "blue",
  paused: "gold",
  completed: "green",
  cancelled: "red",
};

const EXECUTION_STATE_TONE: Record<string, BadgeTone> = {
  unplanned: "neutral",
  briefed: "gold",
  ready: "blue",
  in_progress: "blue",
  in_review: "gold",
  blocked: "red",
  done: "green",
};

export function taskStatusTone(status: string | undefined): BadgeTone {
  return TASK_STATUS_TONE[status ?? ""] ?? "neutral";
}

export function projectStatusTone(status: string | undefined): BadgeTone {
  return PROJECT_STATUS_TONE[status ?? ""] ?? "neutral";
}

export function executionStateTone(state: string | undefined): BadgeTone {
  return EXECUTION_STATE_TONE[state ?? ""] ?? "neutral";
}

export function titleCase(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** The ordered columns of the supervised-execution plan board. */
export const EXECUTION_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "briefed", label: "Briefed" },
  { key: "ready", label: "Ready" },
  { key: "in_progress", label: "In progress" },
  { key: "in_review", label: "In review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

export function badgeToneForState(state: unknown): BadgeTone {
  const text = String(state ?? "").toLowerCase();
  if (/(reject|fail|error|cancel|blocked)/.test(text)) return "red";
  if (/(pending|review|wait|draft|brief)/.test(text)) return "gold";
  if (/(accept|done|complete|sent|achiev)/.test(text)) return "green";
  return "blue";
}
