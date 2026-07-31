"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { BellRing, CalendarDays, Check, Inbox, MapPin, PauseCircle, Plus } from "lucide-react";
import { TASK_AREAS } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { formatRelative } from "../../lib/display";
import { LiveGate } from "../live-auth";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  IconButton,
  LoadingRow,
  Section,
  Select,
  TextInput,
  useToast,
} from "../components";
import { useViewerReady } from "./use-viewer";
import { areaLabel } from "./life-tasks-helpers";
import type { LifeTask } from "./life-tasks-helpers";
import {
  agendaAreas,
  buildAgendaRows,
  filterAgendaRows,
  type AgendaRow,
  type CalendarEventRow,
  type RecurrenceRowInput,
} from "./agenda-rows";
import { CADENCE_PRESETS, type CadencePresetKey } from "./recurrences-helpers";
import styles from "./life-tasks.module.css";

/* ------------------------------------------------------------------ */
/* Agenda: one table for everything the owner is on the hook for —      */
/* tasks, calendar events, and repeating obligations. Type is carried   */
/* by a badge rather than by which section a row lives in, so there is  */
/* one place to look instead of four.                                   */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dateLabel(row: AgendaRow): string | undefined {
  if (typeof row.at !== "number") return undefined;
  // All-day events are stored at UTC midnight and belong to that calendar
  // date, so they are rendered in UTC rather than shifted into local time.
  if (row.isAllDay) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(new Date(row.at));
  }
  return formatRelative(row.at);
}

function waitingDayCount(row: AgendaRow, now: number): number | undefined {
  const since = row.lastNudgedAt ?? row.waitingSince;
  if (typeof since !== "number") return undefined;
  return Math.max(0, Math.floor((now - since) / DAY_MS));
}

function AgendaRowView({
  row,
  now,
  onComplete,
  onNudge,
  onPause,
}: {
  row: AgendaRow;
  now: number;
  onComplete: (row: AgendaRow) => void;
  onNudge: (row: AgendaRow) => void;
  onPause: (row: AgendaRow) => void;
}) {
  const waited = row.isWaiting ? waitingDayCount(row, now) : undefined;
  const when = dateLabel(row);

  return (
    <div className={styles.row} id={`${row.kind}-${row.id}`}>
      {/* Events are attended, not completed, so they get no check control —
          a checkbox that does nothing is worse than no checkbox. */}
      {row.kind === "event" ? (
        <span className={styles.eventMarker} aria-hidden>
          <CalendarDays size={15} />
        </span>
      ) : (
        <button
          type="button"
          className={styles.check}
          onClick={() => onComplete(row)}
          aria-label={`Complete ${row.title}`}
          title={row.kind === "recurrence" ? "Log that you did this" : "Complete"}
        >
          <Check size={14} />
        </button>
      )}

      <div className={styles.rowBody}>
        <span className={styles.rowTitle}>{row.title}</span>
        <span className={styles.rowMeta}>
          {row.kind === "event" ? <Badge tone="blue">Event</Badge> : null}
          {row.kind === "recurrence" || row.fromRecurrence ? (
            <Badge tone="gold">Recurring</Badge>
          ) : null}
          {row.isWaiting ? <Badge tone="neutral">Waiting</Badge> : null}
          {row.isWant ? <Badge tone="neutral">Want</Badge> : null}
          {row.areaLabel ? <Badge tone="neutral">{row.areaLabel}</Badge> : null}

          {when ? (
            <span className={row.isOverdue ? styles.overdue : undefined}>
              {row.isOverdue ? "overdue — " : ""}
              {when}
            </span>
          ) : null}

          {row.location ? (
            <span className={styles.metaItem}>
              <MapPin size={12} aria-hidden /> {row.location}
            </span>
          ) : null}

          {waited !== undefined ? (
            <span>
              {row.lastNudgedAt ? "nudged" : "waiting"} {waited} day{waited === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      </div>

      <div className={styles.rowActions}>
        {row.isWaiting ? (
          <IconButton
            aria-label={`Nudge about ${row.title}`}
            title="Draft a nudge"
            onClick={() => onNudge(row)}
          >
            <BellRing size={15} />
          </IconButton>
        ) : null}
        {row.kind === "recurrence" ? (
          <IconButton
            aria-label={`Pause ${row.title}`}
            title="Pause this repeat"
            onClick={() => onPause(row)}
          >
            <PauseCircle size={15} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Add form, shown inside the Add dialog. Repeating obligations are created
 * from the same box as one-off work: ticking "Repeats" reveals the cadence
 * fields and switches the submit from a task to a recurrence.
 */
function AddRow({ onAdded }: { onAdded: () => void }) {
  const createLifeTask = useMutation(api.lifeTasks.createLifeTask);
  const upsertRecurrence = useMutation(api.recurrences.upsertRecurrenceForViewer);
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [commitment, setCommitment] = useState<"must" | "want">("must");
  const [repeats, setRepeats] = useState(false);
  const [presetKey, setPresetKey] = useState<CadencePresetKey>("every-n-days");
  const [amount, setAmount] = useState("90");
  const [spawnTask, setSpawnTask] = useState(true);
  const [saving, setSaving] = useState(false);

  const preset = CADENCE_PRESETS.find((entry) => entry.key === presetKey) ?? CADENCE_PRESETS[0];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      if (repeats) {
        const numeric = Number(amount);
        await upsertRecurrence({
          title: trimmed,
          ...(area ? { area: area as (typeof TASK_AREAS)[number] } : {}),
          rule: preset.build(Number.isFinite(numeric) ? numeric : 1, new Date()),
          anchor: preset.anchor,
          spawnTask,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        toast(`Added repeating item "${trimmed}".`, "success");
      } else {
        await createLifeTask({
          title: trimmed,
          ...(area ? { area: area as (typeof TASK_AREAS)[number] } : {}),
          commitment,
        });
        toast(`Added "${trimmed}".`, "success");
      }
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
        placeholder={
          repeats
            ? "Something that comes around again…"
            : commitment === "want"
              ? "Something you'd enjoy…"
              : "Something you need to do…"
        }
        aria-label="New item"
        autoFocus
      />

      <div className={styles.addControls}>
        {/* Wants and repeats are mutually exclusive: a want has no schedule. */}
        {!repeats ? (
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
        ) : null}

        <Select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Area">
          <option value="">Unsorted</option>
          {TASK_AREAS.map((value) => (
            <option key={value} value={value}>
              {areaLabel(value)}
            </option>
          ))}
        </Select>

        <Checkbox
          checked={repeats}
          onChange={(event) => {
            setRepeats(event.target.checked);
            if (event.target.checked) setCommitment("must");
          }}
          label="Repeats"
        />

        <Button type="submit" disabled={!title.trim() || saving}>
          {saving ? "Adding…" : "Add"}
        </Button>
      </div>

      {repeats ? (
        <div className={styles.repeatFields}>
          {/* The anchor is never exposed as a raw enum — each option describes
              what will actually happen, and carries its own anchor. */}
          <Select
            value={presetKey}
            onChange={(event) => setPresetKey(event.target.value as CadencePresetKey)}
            aria-label="How it repeats"
          >
            {CADENCE_PRESETS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </Select>
          <p className={styles.hint}>{preset.hint}</p>

          <div className={styles.addControls}>
            {preset.needsDays ? (
              presetKey === "weekly-on-day" ? (
                <Select
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  aria-label="Weekday"
                >
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={String(index)}>
                      {day}
                    </option>
                  ))}
                </Select>
              ) : (
                <TextInput
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  aria-label={presetKey === "monthly-on-day" ? "Day of month" : "Number of days"}
                  style={{ maxWidth: 110 }}
                />
              )
            ) : null}

            <div className={styles.commitmentToggle} role="group" aria-label="When due">
              {[
                { value: true, label: "Add to my list" },
                { value: false, label: "Just show when due" },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  className={`${styles.commitmentOption} ${
                    spawnTask === option.value ? styles.commitmentOptionActive : ""
                  }`}
                  aria-pressed={spawnTask === option.value}
                  onClick={() => setSpawnTask(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function LifeTasksContent() {
  const ready = useViewerReady();
  const now = Date.now();

  // Events are windowed; tasks and recurrences are not, because an undated
  // obligation has no date to filter on and must always stay visible.
  const dayBucket = Math.floor(now / DAY_MS);
  const range = useMemo(
    () => ({ from: dayBucket * DAY_MS - 7 * DAY_MS, to: dayBucket * DAY_MS + 365 * DAY_MS }),
    [dayBucket],
  );

  const tasks = useQuery(api.lifeTasks.lifeTasksForViewer, ready ? {} : "skip") as
    | LifeTask[]
    | undefined;
  const events = useQuery(api.calendar.calendarEventsInRange, ready ? range : "skip") as
    | CalendarEventRow[]
    | undefined;
  const recurrences = useQuery(api.recurrences.recurrencesForViewer, ready ? {} : "skip") as
    | RecurrenceRowInput[]
    | undefined;

  const setStatus = useMutation(api.lifeTasks.setLifeTaskStatus);
  const completeRecurrence = useMutation(api.recurrences.completeRecurrenceForViewer);
  const setRecurrenceStatus = useMutation(api.recurrences.setRecurrenceStatusForViewer);
  const nudge = useMutation(api.waiting.nudgeWaitingTask);
  const toast = useToast();

  const [area, setArea] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(
    () => buildAgendaRows(tasks, events, recurrences, now),
    // `now` is bucketed by day: overdue is a day-scale concept, and depending
    // on the raw clock would rebuild the list on every render.
    [tasks, events, recurrences, dayBucket],
  );
  const areas = useMemo(() => agendaAreas(rows), [rows]);
  const visible = useMemo(() => filterAgendaRows(rows, area), [rows, area]);

  async function onComplete(row: AgendaRow) {
    try {
      if (row.kind === "recurrence") {
        // Completing a repeat logs the completion and advances its schedule
        // rather than closing anything permanently.
        await completeRecurrence({ recurrenceId: row.id as any });
        toast(`Logged "${row.title}".`, "success");
      } else {
        await setStatus({ taskId: row.id as any, status: "done" });
        toast(`Done: ${row.title}`, "success");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update that.", "error");
    }
  }

  async function onNudge(row: AgendaRow) {
    try {
      await nudge({ taskId: row.id as any });
      toast("Nudge drafted — review it in Pending actions.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not draft that.", "error");
    }
  }

  async function onPause(row: AgendaRow) {
    try {
      await setRecurrenceStatus({ recurrenceId: row.id as any, status: "paused" });
      toast(`Paused "${row.title}".`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not pause that.", "error");
    }
  }

  if (tasks === undefined) {
    return <LoadingRow label="Loading agenda…" />;
  }

  return (
    <div className={styles.grid}>
      <Section
        title="Agenda"
        className={styles.fullWidth}
        action={
          <span className={styles.sectionAction}>
            <Badge tone="neutral">{visible.length}</Badge>
            <Button variant="primary" small onClick={() => setAddOpen(true)}>
              <Plus size={15} aria-hidden /> Add
            </Button>
          </span>
        }
      >
        {areas.length > 1 ? (
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
        ) : null}

        {visible.length === 0 ? (
          <EmptyState icon={<Inbox size={18} />} title="Nothing on your plate">
            Tasks, events, and repeating items all show up here.
          </EmptyState>
        ) : (
          <div className={styles.list}>
            {visible.map((row) => (
              <AgendaRowView
                key={`${row.kind}-${row.id}`}
                row={row}
                now={now}
                onComplete={onComplete}
                onNudge={onNudge}
                onPause={onPause}
              />
            ))}
          </div>
        )}
      </Section>

      {/* The add form starts out of the way: the agenda is read far more often
          than it is written to, so adding is a deliberate click. */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add to your agenda">
        <AddRow onAdded={() => setAddOpen(false)} />
      </Dialog>
    </div>
  );
}

export function LifeTasksPage() {
  return (
    <LiveGate>
      <LifeTasksContent />
    </LiveGate>
  );
}
