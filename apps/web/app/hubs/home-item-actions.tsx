"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "../../lib/skippy-api";
import { Button } from "../components";

type ActionRow = { entityKind?: import("../../../../convex/attentionModel").AttentionKind | null; kind: string; id: string; title: string; status?: string; recurrenceId?: string | null | undefined; occurrenceVersion?: number | null | undefined; recurrenceStatus?: string | null | undefined; isWaiting?: boolean | undefined };
type Feedback = { pending?: boolean; error?: string; message?: string };
const keyFor = (row: ActionRow) => row.recurrenceId ? `recurrence:${row.recurrenceId}` : `${row.kind}:${row.id}`;
type ActionState = { state: Record<string, Feedback>; run: (row: ActionRow, work: () => Promise<unknown>, message?: string) => Promise<boolean> };
const Actions = createContext<ActionState | null>(null);
export function HomeActionsProvider({ children }: { children: ReactNode }) {
  const lock = useRef(new Set<string>());
  const [state, setState] = useState<Record<string, Feedback>>({});
  async function run(row: ActionRow, work: () => Promise<unknown>, message = "Saved.") {
    const key = keyFor(row);
    if (lock.current.has(key)) return false;
    lock.current.add(key); setState(previous => ({ ...previous, [key]: { pending: true } }));
    try {
      await work(); setState(previous => ({ ...previous, [key]: { message } })); return true;
    } catch (error) {
      setState(previous => ({ ...previous, [key]: { error: error instanceof Error ? error.message : "Could not save. Try again." } })); return false;
    } finally { lock.current.delete(key); }
  }
  return <Actions.Provider value={{ state, run }}>{children}</Actions.Provider>;
}
export function useItemAction(row: ActionRow) {
  const context = useContext(Actions);
  if (!context) throw new Error("Home actions provider is required");
  return { ...context.state[keyFor(row)], run: (work: () => Promise<unknown>, message?: string) => context.run(row, work, message) };
}
export function ItemActionFeedback({ row }: { row: ActionRow }) {
  const { pending, error, message } = useItemAction(row);
  return <>{pending ? <p role="status" className="text-sm">Saving…</p> : null}
    {error ? <p role="alert" className="text-sm text-red">{error}</p> : null}
    {message && !pending ? <p role="status" className="text-sm">{message}</p> : null}</>;
}
/** Identical completion semantics and pending state in rows and details. */
export function HomeItemActions({ row, details = false }: { row: ActionRow; details?: boolean }) {
  const { pending, run } = useItemAction(row);
  const taskStatus = useMutation(api.lifeTasks.setLifeTaskStatus);
  const occurrence = useMutation(api.recurrences.actOnOccurrenceForViewer);
  const repeatStatus = useMutation(api.recurrences.setRecurrenceStatusForViewer);
  const nudge = useMutation(api.waiting.nudgeWaitingTask);
  const requests = useRef<Record<string, string>>({});
  const open = row.status !== "done" && row.status !== "cancelled" && row.status !== "retired" && row.recurrenceStatus !== "retired";
  function finish(action: "complete" | "skip") {
    void run(async () => {
      if (row.recurrenceId) {
        const key = `${row.recurrenceId}:${row.occurrenceVersion}:${action}`;
        const requestId = requests.current[key] ??= crypto.randomUUID();
        await occurrence({ recurrenceId: row.recurrenceId as any, expectedOccurrenceVersion: row.occurrenceVersion ?? 0, requestId, action });
      } else await taskStatus({ taskId: row.id as any, status: action === "complete" ? "done" : "cancelled" });
    }, action === "complete" ? "Completed." : row.recurrenceId ? "Occurrence skipped." : "Cancelled.");
  }
  if (row.kind === "review") return <ReviewActions row={row} />;
  if (row.kind === "event") return null;
  return <div className="flex flex-wrap items-center gap-2">
    {details && row.recurrenceStatus === "retired" ? <p className="text-sm">This repeat is retired. Its history remains available.</p> : null}
    {open ? <Button className="min-h-11" disabled={pending} aria-label={`Complete ${row.title}`} onClick={() => finish("complete")}>{details ? row.recurrenceId ? "Log completion" : "Complete" : "✓"}</Button> : null}
    {details && open ? <Button disabled={pending} onClick={() => finish("skip")}>{row.recurrenceId ? "Skip occurrence" : "Cancel task"}</Button> : null}
    {details && row.recurrenceId && row.recurrenceStatus !== "retired" ? <Button disabled={pending} onClick={() => void run(() => repeatStatus({ recurrenceId: row.recurrenceId as any, status: row.recurrenceStatus === "active" ? "paused" : "active", expectedOccurrenceVersion: row.occurrenceVersion ?? 0 }))}>{row.recurrenceStatus === "active" ? "Pause repeat" : "Resume repeat"}</Button> : null}
    {details && row.isWaiting && open ? <Button disabled={pending} onClick={() => void run(async () => {
      const result = await nudge({ taskId: row.id as any });
      if (!result.pendingActionId) throw new Error("No nudge was drafted. Choose who this task is waiting on first.");
    }, "Follow-up saved. Automatic message delivery is not available.")}>Save follow-up</Button> : null}
  </div>;
}

function ReviewActions({ row }: { row: ActionRow }) {
  const { pending, run } = useItemAction(row);
  const save = useMutation(api.attention.setForViewer);
  const [later, setLater] = useState(false);
  const [date, setDate] = useState("");
  const submit = (reviewAt?: number) => run(async () => {
    if (!row.entityKind || row.entityKind === "task") throw new Error("Review is unavailable");
    if (reviewAt !== undefined && (!Number.isFinite(reviewAt) || reviewAt <= Date.now())) throw new Error("Choose a future review time");
    await save({ kind: row.entityKind, id: row.id, reviewAction: reviewAt === undefined ? "done" : "later", attention: reviewAt === undefined ? {} : { reviewAt } });
  }, reviewAt === undefined ? "Review finished." : "Review moved.");
  return <div className="flex flex-wrap items-center gap-2">
    <Button className="min-h-11" disabled={pending} onClick={() => void submit()}>Done reviewing</Button>
    <Button className="min-h-11" disabled={pending} onClick={() => setLater(true)}>Later</Button>
    {later ? <form className="flex flex-wrap items-center gap-2" onSubmit={event => {
      event.preventDefault(); void submit(new Date(date).getTime()).then(saved => { if (saved) setLater(false); });
    }}>
      <label className="text-sm">Review on <input aria-label="Review on" type="datetime-local" required disabled={pending} value={date} onChange={event => setDate(event.target.value)} /></label>
      <Button disabled={pending} type="submit">Move review</Button>
      <Button disabled={pending} type="button" onClick={() => setLater(false)}>Cancel</Button>
    </form> : null}
  </div>;
}
