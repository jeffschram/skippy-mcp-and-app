type AnyRecord = Record<string, any>;

export type ChatActivityLine =
  | { kind: "command"; text: string }
  | { kind: "file_change"; text: string }
  | { kind: "status"; text: string }
  | { kind: "error"; text: string };

export type ChatActivity = {
  /** The harness's latest interim narration, shown as streaming reply text. */
  narration?: string;
  /** Compact recent activity lines (commands, edits, status), oldest first. */
  lines: ChatActivityLine[];
  /** Latest TodoWrite snapshot, when the harness is tracking a plan. */
  plan?: { done: number; total: number; current?: string };
};

const STATUS_LABELS: Record<string, string> = {
  session_started: "Session started",
};

function basename(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Distill a turn's live event tail into what the chat panel shows under the
 * in-flight reply: the latest narration, the last few concrete actions, and
 * plan progress. Events arrive oldest-first by seq from chatForScopeForViewer.
 */
export function summarizeChatActivity(events: AnyRecord[], maxLines = 4): ChatActivity {
  const activity: ChatActivity = { lines: [] };
  const lines: ChatActivityLine[] = [];

  for (const event of events) {
    const payload = event.payload ?? {};
    switch (event.type) {
      case "assistant_message": {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (text) activity.narration = text;
        break;
      }
      case "command": {
        const command = typeof payload.command === "string" ? payload.command.trim() : "";
        if (command) lines.push({ kind: "command", text: command.split("\n")[0]!.slice(0, 120) });
        break;
      }
      case "file_change": {
        const filePath = typeof payload.filePath === "string" ? payload.filePath : "";
        if (filePath) lines.push({ kind: "file_change", text: `${payload.tool === "Write" ? "Writing" : "Editing"} ${basename(filePath)}` });
        break;
      }
      case "plan_update": {
        const todos: AnyRecord[] = Array.isArray(payload.todos) ? payload.todos : [];
        if (todos.length) {
          const done = todos.filter((todo) => todo.status === "completed").length;
          const current = todos.find((todo) => todo.status === "in_progress");
          activity.plan = {
            done,
            total: todos.length,
            ...(typeof current?.activeForm === "string" && current.activeForm
              ? { current: current.activeForm }
              : typeof current?.content === "string" && current.content
                ? { current: current.content }
                : {}),
          };
        }
        break;
      }
      case "status": {
        const phase = typeof payload.phase === "string" ? payload.phase : "";
        const label = STATUS_LABELS[phase];
        if (label) lines.push({ kind: "status", text: label });
        break;
      }
      case "error": {
        const message = typeof payload.message === "string" ? payload.message : "";
        if (message) lines.push({ kind: "error", text: message.slice(0, 160) });
        break;
      }
      default:
        break;
    }
  }

  activity.lines = lines.slice(-maxLines);
  return activity;
}
