"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, CalendarClock, PauseCircle, PlayCircle, RotateCcw } from "lucide-react";
import { TASK_AREAS } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { formatRelative } from "../../lib/display";
import {
  Badge,
  Button,
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
import {
  CADENCE_PRESETS,
  bucketRecurrences,
  describeAnchor,
  describeRule,
  type CadencePresetKey,
  type RecurrenceRow,
} from "./recurrences-helpers";
import styles from "./life-tasks.module.css";

/* ------------------------------------------------------------------ */
/* Repeating obligations.                                              */
/*                                                                     */
/* Lives inside /tasks rather than as its own hub: recurrences and life */
/* tasks are the same mental mode, and splitting them means navigating  */
/* two places to answer "what do I need to do?".                       */
/* ------------------------------------------------------------------ */

const WEEKDAY_OPTIONS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function RecurrenceRowView({
  row,
  onComplete,
  onToggleStatus,
}: {
  row: RecurrenceRow;
  onComplete: (row: RecurrenceRow, backdate: boolean) => void;
  onToggleStatus: (row: RecurrenceRow) => void;
}) {
  return (
    <div className={styles.row} id={`recurrence-${row._id}`}>
      <button
        type="button"
        className={styles.check}
        onClick={() => onComplete(row, false)}
        aria-label={`Mark ${row.title} done`}
        title="Did it just now"
      >
        <Check size={14} />
      </button>

      <div className={styles.rowBody}>
        <span className={styles.rowTitle}>{row.title}</span>
        <span className={styles.rowMeta}>
          {row.area ? <Badge tone="neutral">{areaLabel(row.area)}</Badge> : null}
          <span>{describeRule(row.rule)}</span>
          {/* For a completion-anchored item this is the load-bearing fact —
              more useful day to day than the next due date. */}
          <span>
            {row.lastCompletedAt
              ? `last done ${formatRelative(row.lastCompletedAt)}`
              : "never done"}
          </span>
          <span>due {formatRelative(row.nextDueAt)}</span>
          {!row.spawnTask ? <Badge tone="neutral">agenda only</Badge> : null}
        </span>
      </div>

      <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
        <IconButton
          aria-label={`Log an earlier completion of ${row.title}`}
          onClick={() => onComplete(row, true)}
          title="I did this earlier"
        >
          <RotateCcw size={15} />
        </IconButton>
        <IconButton
          aria-label={`${row.status === "paused" ? "Resume" : "Pause"} ${row.title}`}
          onClick={() => onToggleStatus(row)}
          title={row.status === "paused" ? "Resume" : "Pause"}
        >
          {row.status === "paused" ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
        </IconButton>
      </div>
    </div>
  );
}

function AddRecurrence() {
  const upsert = useMutation(api.recurrences.upsertRecurrenceForViewer);
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
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
      const numeric = Number(amount);
      const rule = preset.build(Number.isFinite(numeric) ? numeric : 1, new Date());

      await upsert({
        title: trimmed,
        ...(area ? { area: area as (typeof TASK_AREAS)[number] } : {}),
        rule,
        anchor: preset.anchor,
        spawnTask,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      setTitle("");
      toast(`Added "${trimmed}".`, "success");
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
        placeholder="Something that comes around again…"
        aria-label="New recurring obligation"
      />

      {/* The anchor is never exposed as a raw enum — each option describes what
          will actually happen, and carries its own anchor. */}
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
      <p className={styles.wantsNote}>{preset.hint}</p>

      <div className={styles.addControls}>
        {preset.needsDays ? (
          presetKey === "weekly-on-day" ? (
            <Select value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Weekday">
              {WEEKDAY_OPTIONS.map((day, index) => (
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

        <Select value={area} onChange={(event) => setArea(event.target.value)} aria-label="Area">
          <option value="">Unsorted</option>
          {TASK_AREAS.map((value) => (
            <option key={value} value={value}>
              {areaLabel(value)}
            </option>
          ))}
        </Select>

        {/* spawnTask in plain language too. */}
        <div className={styles.commitmentToggle} role="group" aria-label="When due">
          {[
            { value: true, label: "Add to my tasks" },
            { value: false, label: "Just show on agenda" },
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

        <Button type="submit" disabled={!title.trim() || saving}>
          {saving ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

export function RecurrencesContent() {
  const ready = useViewerReady();
  const rows = useQuery(api.recurrences.recurrencesForViewer, ready ? {} : "skip") as
    | RecurrenceRow[]
    | undefined;
  const complete = useMutation(api.recurrences.completeRecurrenceForViewer);
  const setStatus = useMutation(api.recurrences.setRecurrenceStatusForViewer);
  const toast = useToast();

  const now = Date.now();
  const buckets = useMemo(() => bucketRecurrences(rows, now), [rows, now]);

  async function onComplete(row: RecurrenceRow, backdate: boolean) {
    // Backdating matters more than it looks: for a completion-anchored
    // recurrence the timestamp directly sets the next due date.
    let completedAt: number | undefined;
    if (backdate) {
      const answer = window.prompt(
        `When did you do "${row.title}"? (YYYY-MM-DD)`,
        new Date(now).toISOString().slice(0, 10),
      );
      if (!answer) return;
      const parsed = Date.parse(`${answer}T12:00:00`);
      if (!Number.isFinite(parsed)) {
        toast("Could not read that date.", "error");
        return;
      }
      completedAt = parsed;
    }

    try {
      await complete({
        recurrenceId: row._id as any,
        ...(completedAt !== undefined ? { completedAt } : {}),
      });
      toast(`Logged "${row.title}".`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not log that.", "error");
    }
  }

  async function onToggleStatus(row: RecurrenceRow) {
    try {
      await setStatus({
        recurrenceId: row._id as any,
        status: row.status === "paused" ? "active" : "paused",
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update that.", "error");
    }
  }

  if (rows === undefined) {
    return <LoadingRow label="Loading recurring items…" />;
  }

  const sections: Array<{ title: string; items: RecurrenceRow[]; empty: string }> = [
    { title: "Due now", items: buckets.due, empty: "Nothing due." },
    { title: "Coming up", items: buckets.upcoming, empty: "Nothing scheduled yet." },
  ];

  return (
    <div className={styles.grid}>
      <Section title="Add a repeating item" className={styles.fullWidth}>
        <AddRecurrence />
      </Section>

      {sections.map((section) => (
        <Section
          key={section.title}
          title={section.title}
          className={styles.fullWidth}
          action={<Badge tone="neutral">{section.items.length}</Badge>}
        >
          {section.items.length === 0 ? (
            <EmptyState icon={<CalendarClock size={18} />} title={section.empty} />
          ) : (
            <div className={styles.list}>
              {section.items.map((row) => (
                <RecurrenceRowView
                  key={row._id}
                  row={row}
                  onComplete={onComplete}
                  onToggleStatus={onToggleStatus}
                />
              ))}
            </div>
          )}
        </Section>
      ))}

      {buckets.paused.length > 0 ? (
        <Section title="Paused" className={styles.fullWidth}>
          <div className={styles.list}>
            {buckets.paused.map((row) => (
              <RecurrenceRowView
                key={row._id}
                row={row}
                onComplete={onComplete}
                onToggleStatus={onToggleStatus}
              />
            ))}
          </div>
        </Section>
      ) : null}

      <p className={styles.wantsNote}>
        Repeats are {describeAnchor("completion")} or {describeAnchor("schedule")}, depending on
        which option you picked when adding them.
      </p>
    </div>
  );
}
