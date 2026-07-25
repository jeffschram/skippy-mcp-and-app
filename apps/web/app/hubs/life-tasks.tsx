"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { BellRing, Check, Clock, Hourglass, ListTodo, Sparkles } from "lucide-react";
import { TASK_AREAS } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { formatRelative } from "../../lib/display";
import { LiveGate } from "../live-auth";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  LoadingRow,
  Section,
  Select,
  Tabs,
  TextInput,
  useToast,
} from "../components";
import { RecurrencesContent } from "./recurrences";
import { useViewerReady } from "./use-viewer";
import {
  areaLabel,
  areasPresent,
  bucketLifeTasks,
  filterByArea,
  isOverdue,
  waitingDays,
  type LifeTask,
} from "./life-tasks-helpers";
import styles from "./life-tasks.module.css";

/* ------------------------------------------------------------------ */
/* The life-task surface: obligations and wants that belong to no        */
/* project. Three lanes plus a waiting list — see life-tasks-helpers.ts  */
/* for why wants are kept apart from obligations.                       */
/* ------------------------------------------------------------------ */

function TaskRow({
  task,
  now,
  onComplete,
  onNudge,
}: {
  task: LifeTask;
  now: number;
  onComplete: (task: LifeTask) => void;
  onNudge?: ((task: LifeTask) => void) | undefined;
}) {
  const overdue = isOverdue(task, now);
  const waited = waitingDays(task, now);

  return (
    <div className={styles.row} id={`task-${task._id}`}>
      <button
        type="button"
        className={styles.check}
        onClick={() => onComplete(task)}
        aria-label={`Complete ${task.title}`}
        title="Complete"
      >
        <Check size={14} />
      </button>

      <div className={styles.rowBody}>
        <span className={styles.rowTitle}>{task.title}</span>
        <span className={styles.rowMeta}>
          {task.area ? <Badge tone="neutral">{areaLabel(task.area)}</Badge> : null}
          {task.recurrenceId ? <Badge tone="blue">Recurring</Badge> : null}
          {/* Wants never render a date or an overdue state. */}
          {task.commitment !== "want" && typeof task.dueAt === "number" ? (
            <span className={overdue ? styles.overdue : undefined}>
              {overdue ? "Overdue " : "Due "}
              {formatRelative(task.dueAt)}
            </span>
          ) : null}
          {waited !== undefined ? (
            <span>
              {task.lastNudgedAt ? "nudged" : "waiting"} {waited} day{waited === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      </div>

      {onNudge ? (
        <IconButton
          aria-label={`Nudge about ${task.title}`}
          title="Draft a nudge"
          onClick={() => onNudge(task)}
        >
          <BellRing size={15} />
        </IconButton>
      ) : null}
    </div>
  );
}

function Lane({
  title,
  icon,
  tasks,
  now,
  emptyLabel,
  note,
  onComplete,
  onNudge,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: LifeTask[];
  now: number;
  emptyLabel: string;
  note?: string | undefined;
  onComplete: (task: LifeTask) => void;
  onNudge?: ((task: LifeTask) => void) | undefined;
  className?: string | undefined;
}) {
  return (
    <Section
      title={title}
      className={className}
      // Wants get no count badge: a number turns a browsable list into a backlog.
      action={note ? null : <Badge tone="neutral">{tasks.length}</Badge>}
    >
      {note ? <p className={styles.wantsNote}>{note}</p> : null}
      {tasks.length === 0 ? (
        <EmptyState icon={icon} title={emptyLabel} />
      ) : (
        <div className={styles.list}>
          {tasks.map((task) => (
            <TaskRow
              key={task._id}
              task={task}
              now={now}
              onComplete={onComplete}
              onNudge={onNudge}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function AddTask({ onAdded }: { onAdded: () => void }) {
  const createLifeTask = useMutation(api.lifeTasks.createLifeTask);
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [commitment, setCommitment] = useState<"must" | "want">("must");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      await createLifeTask({
        title: trimmed,
        ...(area ? { area: area as (typeof TASK_AREAS)[number] } : {}),
        commitment,
      });
      setTitle("");
      onAdded();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not add that.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.addRow} onSubmit={submit}>
      <TextInput
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={commitment === "want" ? "Something you'd enjoy…" : "Something you need to do…"}
        aria-label="New task"
      />
      <div className={styles.addControls}>
        <div className={styles.commitmentToggle} role="group" aria-label="Commitment">
          {(["must", "want"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.commitmentOption} ${
                commitment === value ? styles.commitmentOptionActive : ""
              }`}
              aria-pressed={commitment === value}
              onClick={() => setCommitment(value)}
            >
              {value === "must" ? "Need to" : "Want to"}
            </button>
          ))}
        </div>
        <Select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Area">
          <option value="">Unsorted</option>
          {TASK_AREAS.map((value) => (
            <option key={value} value={value}>
              {areaLabel(value)}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={!title.trim() || saving}>
          {saving ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

export function LifeTasksContent() {
  const ready = useViewerReady();
  const tasks = useQuery(api.lifeTasks.lifeTasksForViewer, ready ? {} : "skip") as
    | LifeTask[]
    | undefined;
  const setStatus = useMutation(api.lifeTasks.setLifeTaskStatus);
  const nudge = useMutation(api.waiting.nudgeWaitingTask);
  const toast = useToast();

  const [area, setArea] = useState<string | null>(null);
  // Recomputed per render rather than ticking: overdue is a day-scale concept
  // and a timer here would rerender the whole list every second.
  const now = Date.now();

  const lanes = useMemo(() => bucketLifeTasks(tasks), [tasks]);
  const areas = useMemo(() => areasPresent(tasks), [tasks]);

  async function complete(task: LifeTask) {
    try {
      await setStatus({ taskId: task._id as any, status: "done" });
      toast(`Done: ${task.title}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update that.", "error");
    }
  }

  async function onNudge(task: LifeTask) {
    try {
      await nudge({ taskId: task._id as any });
      // Nothing is sent from here — the draft waits for the owner to release it.
      toast("Nudge drafted — review it in Pending actions.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not draft that.", "error");
    }
  }

  if (tasks === undefined) {
    return <LoadingRow label="Loading tasks…" />;
  }

  const visible = (list: LifeTask[]) => filterByArea(list, area);

  return (
    <div className={styles.grid}>
      <Section title="Add" className={styles.fullWidth}>
        <AddTask onAdded={() => undefined} />
      </Section>

      {areas.length > 1 ? (
        <div className={styles.fullWidth}>
          <div className={styles.filters}>
            <button
              type="button"
              className={`${styles.filterChip} ${area === null ? styles.filterChipActive : ""}`}
              onClick={() => setArea(null)}
            >
              All
            </button>
            {areas.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.filterChip} ${area === value ? styles.filterChipActive : ""}`}
                onClick={() => setArea(area === value ? null : value)}
              >
                {areaLabel(value === "unsorted" ? undefined : value)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Lane
        title="Due"
        icon={<Clock size={18} />}
        tasks={visible(lanes.due)}
        now={now}
        emptyLabel="Nothing with a deadline."
        onComplete={complete}
      />

      <Lane
        title="Anytime"
        icon={<ListTodo size={18} />}
        tasks={visible(lanes.anytime)}
        now={now}
        emptyLabel="No open obligations."
        onComplete={complete}
      />

      {lanes.waiting.length > 0 ? (
        <Lane
          title="Waiting on"
          icon={<Hourglass size={18} />}
          tasks={visible(lanes.waiting)}
          now={now}
          emptyLabel="Not waiting on anyone."
          onComplete={complete}
          onNudge={onNudge}
          className={styles.fullWidth}
        />
      ) : null}

      <Lane
        title="Wants"
        icon={<Sparkles size={18} />}
        tasks={visible(lanes.wants)}
        now={now}
        emptyLabel="Nothing on the list yet."
        note="Things you'd enjoy. No deadlines, nothing overdue — dip in when you have time."
        onComplete={complete}
        className={styles.fullWidth}
      />
    </div>
  );
}

/**
 * One-off items and repeating obligations are the same mental mode — "what do
 * I need to do?" — so they share a surface behind a segmented control rather
 * than living in two hubs.
 */
function LifeTasksTabs() {
  const [tab, setTab] = useState<"tasks" | "recurring">("tasks");

  return (
    <>
      <Tabs
        items={[
          { key: "tasks", label: "Tasks" },
          { key: "recurring", label: "Recurring" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "tasks" | "recurring")}
      />
      {tab === "tasks" ? <LifeTasksContent /> : <RecurrencesContent />}
    </>
  );
}

export function LifeTasksPage() {
  return (
    <LiveGate>
      <LifeTasksTabs />
    </LiveGate>
  );
}
