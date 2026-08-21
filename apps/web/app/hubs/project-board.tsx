"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  GripVertical,
  Link2,
  ListChecks,
  MessageCircle,
  Play,
  Plus,
  Rocket,
  Settings2,
  ShieldAlert,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import {
  pendingApprovalCount,
  pendingApprovalsByTask,
} from "../../lib/approvals";
import { buildTaskMoments } from "../../lib/task-moments";
import { ProjectChatWorkspace } from "../components/chat-panel";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  LoadingRow,
  Select,
  TextArea,
  TextInput,
  useToast,
} from "../components";
import { LiveGate } from "../live-auth";
import {
  completedPhaseSummary,
  partitionPhasesByCompletion,
  phaseCompletion,
} from "./project-plan-helpers";
import {
  dropPlacement,
  listsEqual,
  phaseDropId,
  projectDragEnd,
  projectDragOver,
  type PhaseList,
} from "./project-board-dnd";
import { createPadAutosave } from "./project-notes-helpers";
import { ProjectLibrarySection } from "./project-library";
import { TaskDetailPanel } from "./task-detail";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;
type ProjectView = "chat" | "overview" | "plan" | "notes" | "library";

const panelTabs: Array<{ key: Exclude<ProjectView, "chat">; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "plan", label: "Plan" },
  { key: "notes", label: "Notes" },
  { key: "library", label: "Library" },
];

const mobileTabs: Array<{
  key: ProjectView;
  label: string;
  icon: typeof MessageCircle;
}> = [
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "overview", label: "Overview", icon: FileText },
  { key: "plan", label: "Plan", icon: ListChecks },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "library", label: "Library", icon: Link2 },
];

function displayState(
  task: AnyRecord,
): "Not started" | "In Progress" | "Completed" {
  if (task.executionState === "done" || task.status === "done")
    return "Completed";
  if (
    task.executionState === "in_progress" ||
    task.executionState === "in_review" ||
    task.agentRequestStatus === "requested"
  )
    return "In Progress";
  return "Not started";
}

// Grow a textarea to fit its content so inline fields read as document text
// (no inner scrollbar). Reset first so shrinking content also shrinks the box.
function autosizeTextArea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function PhaseTitle({ phase }: { phase: AnyRecord }) {
  const updatePhase = useMutation(api.projects.updatePhaseForViewer);
  const toast = useToast();
  const [draft, setDraft] = useState(phase.title ?? "");
  const focused = useRef(false);
  const field = useRef<HTMLTextAreaElement | null>(null);

  // Focused-editing guard: only sync remote updates while the field is idle.
  useEffect(() => {
    if (!focused.current) setDraft(phase.title ?? "");
  }, [phase.title]);

  useEffect(() => {
    autosizeTextArea(field.current);
  }, [draft]);

  return (
    <h2 className="m-0 text-xl">
      <textarea
        ref={field}
        rows={1}
        className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-heading text-xl font-medium leading-snug text-foreground focus:outline-none"
        aria-label="Phase title"
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onKeyDown={(event) => {
          // Titles are single-line: Enter commits via the blur-to-save path.
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          focused.current = false;
          const next = event.currentTarget.value.trim();
          const previous = phase.title ?? "";
          // The server rejects empty titles, so revert instead of saving.
          if (!next) {
            setDraft(previous);
            return;
          }
          setDraft(next);
          if (next === previous) return;
          void updatePhase({ phaseId: phase._id as any, title: next }).catch(
            (error) => {
              setDraft(previous);
              toast(
                error instanceof Error
                  ? error.message
                  : "Could not rename phase",
                "error",
              );
            },
          );
        }}
        onChange={(event) => setDraft(event.target.value)}
      />
    </h2>
  );
}

function PhaseDescription({ phase }: { phase: AnyRecord }) {
  const updatePhase = useMutation(api.projects.updatePhaseForViewer);
  const [draft, setDraft] = useState(phase.descriptionMd ?? "");
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!focused.current) setDraft(phase.descriptionMd ?? "");
  }, [phase.descriptionMd]);

  // Fit the full description on load and while typing — the board surface
  // should read like a document, not a scrollable form field.
  useEffect(() => {
    autosizeTextArea(field.current);
  }, [draft]);

  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value === (phase.descriptionMd ?? "")) return;
    timer.current = setTimeout(() => {
      void updatePhase({ phaseId: phase._id as any, descriptionMd: value });
    }, 650);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <textarea
      ref={field}
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-relaxed text-muted-foreground placeholder:text-muted-foreground/55 focus:outline-none"
      aria-label={`${phase.title} description`}
      placeholder="Type a phase description in Markdown…"
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(event) => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        if (event.currentTarget.value !== (phase.descriptionMd ?? "")) {
          void updatePhase({
            phaseId: phase._id as any,
            descriptionMd: event.currentTarget.value,
          });
        }
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        save(event.target.value);
      }}
    />
  );
}

function TaskRow({
  task,
  busy,
  pendingApprovals = 0,
  onSelect,
  onStart,
  onComplete,
  handleRef,
  handleProps,
  overlay = false,
}: {
  task: AnyRecord;
  busy: boolean;
  /** Pending run approvals waiting on the owner for this task. */
  pendingApprovals?: number;
  onSelect: () => void;
  onStart: () => void;
  onComplete: () => void;
  /** dnd-kit activator ref — drags start from the grip, not the whole row. */
  handleRef?: (node: HTMLElement | null) => void;
  handleProps?: Record<string, unknown>;
  /** Rendered inside a DragOverlay: presentation only, floating above. */
  overlay?: boolean;
}) {
  const state = displayState(task);
  const completed = state === "Completed";
  const inProgress = state === "In Progress";
  // Every actionable row carries its own start affordance; owner tasks that
  // are underway swap it for a complete affordance. Agent tasks in progress
  // rely on the in-progress accent (the workspace run owns their lifecycle).
  const action = !inProgress
    ? {
        icon: Play,
        label: task.ownerType === "agent" ? "Start task" : "Mark in progress",
        onClick: onStart,
      }
    : task.ownerType !== "agent"
      ? { icon: Check, label: "Mark complete", onClick: onComplete }
      : null;

  if (completed) {
    return (
      <article
        onClick={onSelect}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-sm text-muted-foreground hover:border-border"
      >
        <CheckCircle2 className="text-green" size={16} aria-hidden />
        <span className="min-w-0 flex-1 whitespace-normal break-words text-[13px] leading-snug line-through decoration-border">
          {task.title}
        </span>
        <span className="text-xs">Completed</span>
      </article>
    );
  }

  return (
    <article
      onClick={onSelect}
      className={cn(
        // overflow-hidden clips the in-progress shimmer bar to the rounded
        // corners; `relative` anchors it to the row's bottom edge.
        "relative cursor-pointer overflow-hidden rounded-xl border bg-background/40 p-3 transition-colors",
        inProgress
          ? "border-gold/50 hover:border-gold/75"
          : "border-border hover:border-primary/45",
        overlay && "shadow-lg",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* touch-none lets the TouchSensor own the gesture: without it the
            page scrolls instead of dragging on mobile. */}
        <button
          type="button"
          ref={handleRef}
          {...handleProps}
          aria-label={`Reorder ${task.title}`}
          onClick={(event) => event.stopPropagation()}
          className="-m-1 mt-0 grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground/55 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical size={16} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {task.ownerType === "agent" ? (
              // Icon instead of a text badge: agent ownership is ambient
              // metadata, not something to read on every row.
              <span
                title="Agent task"
                className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
              >
                <Bot size={13} aria-hidden />
                <span className="sr-only">Agent task</span>
              </span>
            ) : null}
            <h3 className="m-0 min-w-0 flex-[1_1_180px] whitespace-normal break-words text-[13px] font-semibold leading-snug">
              {task.title}
            </h3>
            {pendingApprovals > 0 ? (
              // A waiting run must be discoverable without scrolling chat:
              // the gate badge outranks the generic in-progress accent.
              <Badge tone="gold">
                <ShieldAlert size={12} aria-hidden /> Needs approval
              </Badge>
            ) : null}
            {inProgress ? (
              <span className="sr-only">In progress</span>
            ) : null}
          </div>
        </div>
        {action ? (
          <button
            type="button"
            aria-label={action.label}
            title={action.label}
            disabled={busy}
            onClick={(event) => {
              // The row itself opens the detail panel; the action button
              // must not also trigger that navigation.
              event.stopPropagation();
              action.onClick();
            }}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full border border-primary/45 text-primary transition-colors",
              "hover:bg-primary hover:text-primary-foreground disabled:pointer-events-none disabled:opacity-45",
              busy && "animate-pulse",
            )}
          >
            <action.icon size={13} aria-hidden />
          </button>
        ) : null}
      </div>
      {inProgress ? (
        // The pre-v2 board marked in-progress work with an animated gradient
        // progress bar; this shimmer strip is the same idea at 2px. The CSS
        // class swaps to a static bar under prefers-reduced-motion.
        <span
          aria-hidden
          className="task-progress-shimmer absolute inset-x-0 bottom-0 h-0.5"
        />
      ) : null}
    </article>
  );
}

/**
 * Sortable wrapper for an open task row. The wrapper div carries dnd-kit's
 * transform/transition; the grip inside TaskRow is the activator so taps and
 * scrolls on the row body never start a drag (mobile matters here). While a
 * row is dragged, the in-place copy dims and the DragOverlay clone follows
 * the pointer.
 */
function SortableTaskRow({
  task,
  busy,
  pendingApprovals = 0,
  onSelect,
  onStart,
  onComplete,
}: {
  task: AnyRecord;
  busy: boolean;
  pendingApprovals?: number;
  onSelect: () => void;
  onStart: () => void;
  onComplete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id as string });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <TaskRow
        task={task}
        busy={busy}
        pendingApprovals={pendingApprovals}
        onSelect={onSelect}
        onStart={onStart}
        onComplete={onComplete}
        handleRef={setActivatorNodeRef}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function ProjectOverview({ project }: { project: AnyRecord }) {
  const links = [
    project.repoUrl
      ? { label: "GitHub repository", href: project.repoUrl, icon: GitBranch }
      : null,
    project.vercelUrl
      ? { label: "Vercel project", href: project.vercelUrl, icon: Rocket }
      : null,
    project.liveUrl
      ? { label: "Live site", href: project.liveUrl, icon: ExternalLink }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    href: string;
    icon: typeof GitBranch;
  }>;

  return (
    <div className="space-y-7 p-5 desk:p-6">
      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-green">
          {project.kind === "code" ? "Code project" : "Project"}
        </p>
        <h1 className="text-[clamp(32px,4vw,52px)]">{project.title}</h1>
        <p className="mb-0 mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground">
          {project.summary ||
            "No project description yet. Ask chat to add one."}
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg">Links</h2>
        {links.length ? (
          <div className="grid gap-2">
            {links.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm font-bold text-foreground no-underline hover:border-primary"
              >
                <item.icon size={17} className="text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <ExternalLink
                  size={14}
                  className="text-muted-foreground"
                  aria-hidden
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No links yet. Ask chat to add the GitHub, Vercel, or live URL.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * The Notes tab: one freeform, always-editable plain-text pad per project —
 * a notepad, not a document system. Thinking is editing, so this is a single
 * textarea the owner can rewrite/merge/reorder freely, not a stack of note
 * entries. Structure belongs in the Plan; history is captured by whole-pad
 * snapshots at review time (no UI here in v1). Same document treatment as
 * PhaseDescription: borderless, autosized, debounced autosave + blur commit,
 * and a focused-editing guard so a remote update (e.g. the same pad open on
 * another device) never clobbers an in-focus edit. Last-write-wins is fine
 * for a single-owner pad.
 */
function ProjectNotesPad({ project }: { project: AnyRecord }) {
  const updateNotes = useMutation(api.projects.updateProjectNotesForViewer);
  const [draft, setDraft] = useState(project.notesPad ?? "");
  const field = useRef<HTMLTextAreaElement | null>(null);
  // Read lazily by the autosave controller so dirty-checks always compare
  // against the freshest persisted value, not the value at mount time.
  const saved = useRef(project.notesPad ?? "");
  saved.current = project.notesPad ?? "";

  // Save status lives entirely in the component so the autosave helper stays
  // a pure, React-free unit. "error" is sticky until a later save succeeds;
  // because a failed save never advances `saved`, the draft stays dirty and
  // the next change/blur naturally retries. The draft is never cleared.
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  // Monotonic sequence so an older save settling late can't overwrite the
  // status of a newer in-flight save.
  const saveSeq = useRef(0);

  const pad = useMemo(
    () =>
      createPadAutosave({
        savedValue: () => saved.current,
        save: (value) => {
          const seq = ++saveSeq.current;
          setSaveState("saving");
          updateNotes({
            projectId: project._id as any,
            notesPad: value,
          }).then(
            () => {
              if (seq === saveSeq.current) setSaveState("saved");
            },
            () => {
              // Silent loss is how pad content vanished once (backend function
              // missing after a partial deploy): surface it instead.
              if (seq === saveSeq.current) setSaveState("error");
            },
          );
        },
      }),
    [project._id, updateNotes],
  );

  // Unmount flushes (not cancels) a pending dirty debounce: React does not
  // reliably fire blur when a focused textarea unmounts (tab switch to Plan,
  // route change), and cancelling would drop the trailing keystrokes.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => () => pad.dispose(draftRef.current), [pad]);

  // Focused-editing guard: sync the reactive value only while the pad is idle.
  useEffect(() => {
    const next = pad.remoteValue(project.notesPad ?? "");
    if (next !== null) setDraft(next);
  }, [pad, project.notesPad]);

  useEffect(() => {
    autosizeTextArea(field.current);
  }, [draft]);

  return (
    <div className="p-4 desk:p-6">
      <textarea
        ref={field}
        // min-h keeps a big tap target on an empty pad (this is the primary
        // phone capture surface); autosize takes over as content grows.
        className="block min-h-[50dvh] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/55 focus:outline-none"
        aria-label="Project notes"
        placeholder="Drop thoughts here…"
        value={draft}
        onFocus={() => pad.handleFocus()}
        onBlur={(event) => pad.handleBlur(event.currentTarget.value)}
        onChange={(event) => {
          setDraft(event.target.value);
          pad.handleChange(event.target.value);
        }}
      />
      {saveState === "error" ? (
        // Persistent but compact: this is a notepad, not a form, so no modal —
        // just make the failure visible until a retry succeeds.
        <p
          role="status"
          className="mt-2 text-xs font-bold text-muted-foreground"
        >
          Couldn&rsquo;t save — your unsaved changes are kept here and will
          retry on the next edit.
        </p>
      ) : null}
    </div>
  );
}

function PhaseSection({
  phase,
  phaseTasks,
  sortedIncompleteTasks,
  busyTaskId,
  approvalsByTask,
  onSelect,
  onStart,
  onComplete,
}: {
  phase: AnyRecord;
  phaseTasks: AnyRecord[];
  /** Open tasks in render order — projected mid-drag by ProjectPlan. */
  sortedIncompleteTasks: AnyRecord[];
  busyTaskId: string | null;
  approvalsByTask: Record<string, number>;
  onSelect: (task: AnyRecord) => void;
  onStart: (task: AnyRecord) => void;
  onComplete: (task: AnyRecord) => void;
}) {
  // The phase's task list is a droppable of its own so a task can be dropped
  // into a phase with no open rows (dnd-kit's multiple-lists pattern). Called
  // before the collapsed-phase early return to keep hook order stable.
  const { setNodeRef, isOver } = useDroppable({ id: phaseDropId(phase._id) });
  const completion = phaseCompletion(phaseTasks);
  // A completed phase (rendered inside the Plan's bottom "Completed phases"
  // section) defaults to its compact collapsed row. "expanded" only matters
  // while the phase is complete; a reopened or new task flips `completion`
  // to "active" and the full rendering returns on its own, no state reset
  // needed.
  const [expanded, setExpanded] = useState(false);
  const completedTasks = phaseTasks.filter(
    (task) => displayState(task) === "Completed",
  );
  const completeCount = completedTasks.length;

  if (completion === "complete" && !expanded) {
    return (
      <section>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-transparent px-2 pt-2 pb-2 text-left hover:border-border"
        >
          <div className="min-w-0 flex-1">
            {/* Keep the h2 typography of PhaseTitle so the collapsed row
                still scans as part of the plan document. */}
            <h2 className="m-0 flex items-center gap-2 text-xl">
              <CheckCircle2
                className="shrink-0 text-green"
                size={18}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-heading text-xl font-medium leading-snug">
                {phase.title}
              </span>
            </h2>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {completedPhaseSummary(phaseTasks.length)}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-3 pt-2 mb-2">
        <div className="min-w-0 flex-1">
          <PhaseTitle phase={phase} />
        </div>
        {completion === "complete" ? (
          // The title stays an editable textarea while expanded, so the
          // collapse affordance lives beside it instead of on the whole
          // header (a header-wide click target would swallow edit clicks).
          <button
            type="button"
            aria-expanded
            title="Collapse completed phase"
            onClick={() => setExpanded(false)}
            className="mt-1 flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <CheckCircle2 className="text-green" size={14} aria-hidden />
            {completedPhaseSummary(phaseTasks.length)}
          </button>
        ) : (
          <span className="mt-1 text-xs text-muted-foreground">
            {completeCount}/{phaseTasks.length}
          </span>
        )}
      </div>
      <PhaseDescription phase={phase} />
      <div
        ref={setNodeRef}
        className={cn(
          "mt-2 grid gap-2",
          // A phase with no open rows keeps a slim invisible landing strip;
          // it lights up only while a dragged task hovers it. This replaces
          // the old always-visible "drop here" target areas — row gaps from
          // dnd-kit are the drop indicators everywhere else.
          sortedIncompleteTasks.length === 0 &&
            "min-h-10 rounded-lg border border-dashed border-transparent",
          sortedIncompleteTasks.length === 0 && isOver && "border-primary/60",
        )}
      >
        <SortableContext
          items={sortedIncompleteTasks.map((task) => task._id as string)}
          strategy={verticalListSortingStrategy}
        >
          {sortedIncompleteTasks.map((task) => (
            <SortableTaskRow
              key={task._id}
              task={task}
              busy={busyTaskId === task._id}
              pendingApprovals={approvalsByTask[task._id] ?? 0}
              onSelect={() => onSelect(task)}
              onStart={() => onStart(task)}
              onComplete={() => onComplete(task)}
            />
          ))}
        </SortableContext>
        {completedTasks.length ? (
          <details className="mt-2 rounded-xl border bg-background/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-bold text-muted-foreground">
              Completed ({completedTasks.length})
            </summary>
            <div className="mt-2 grid gap-1 border-t pt-2">
              {completedTasks.map((task) => (
                <TaskRow
                  key={task._id}
                  task={task}
                  busy={busyTaskId === task._id}
                  onSelect={() => onSelect(task)}
                  onStart={() => onStart(task)}
                  onComplete={() => onComplete(task)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ProjectPlan({
  board,
  busyTaskId,
  approvalsByTask,
  onSelect,
  onStart,
  onComplete,
}: {
  board: AnyRecord;
  busyTaskId: string | null;
  approvalsByTask: Record<string, number>;
  onSelect: (task: AnyRecord) => void;
  onStart: (task: AnyRecord) => void;
  onComplete: (task: AnyRecord) => void;
}) {
  const createPhase = useMutation(api.projects.createPhaseForViewer);
  const reorderTask = useMutation(api.projects.reorderTaskInPhaseForViewer);
  const toast = useToast();
  const tasks: AnyRecord[] = board.tasks ?? [];
  const phases: AnyRecord[] = board.phases ?? [];
  const tasksForPhase = (phase: AnyRecord) =>
    tasks.filter((task) => task.phaseId === phase._id);
  // Fully-completed phases sink into one collapsed section at the bottom so
  // the top of the Plan is only live work; reopening a task flips its phase
  // back to "active" and it returns to its original slot automatically.
  const { activePhases, completedPhases } = partitionPhasesByCompletion(
    phases,
    tasksForPhase,
  );

  // Drag starts from the row grips only. The mouse needs a small distance
  // threshold so plain clicks still open the detail panel; touch needs a
  // hold delay so scrolling the Plan never turns into an accidental drag.
  // Keyboard sorting comes for free via the focusable grip buttons.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task._id as string, task])),
    [tasks],
  );
  // Baseline arrangement: open (non-completed) task ids per phase, in the
  // board's orderIndex order. Completed tasks live in each phase's collapsed
  // details section and are not sortable.
  const baseLists: PhaseList[] = useMemo(
    () =>
      phases.map((phase) => ({
        phaseId: phase._id as string,
        taskIds: tasks
          .filter(
            (task) =>
              task.phaseId === phase._id &&
              displayState(task) !== "Completed",
          )
          .map((task) => task._id as string),
      })),
    [phases, tasks],
  );
  // While a drag is live (and until its mutation settles), render from the
  // projected arrangement instead of the server's — this is what makes rows
  // visibly part while dragging and prevents a snap-back before Convex
  // pushes the reordered board.
  const [dragLists, setDragLists] = useState<PhaseList[] | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const renderLists = dragLists ?? baseLists;
  const sortedIncompleteFor = (phase: AnyRecord): AnyRecord[] => {
    const list = renderLists.find((entry) => entry.phaseId === phase._id);
    return (list?.taskIds ?? [])
      .map((taskId) => taskById.get(taskId))
      .filter(Boolean) as AnyRecord[];
  };
  const activeTask = activeTaskId ? taskById.get(activeTaskId) : null;

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveTaskId(String(active.id));
    setDragLists(baseLists);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragLists((current) => {
      const lists = current ?? baseLists;
      return projectDragOver(lists, String(active.id), String(over.id)) ?? current;
    });
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
    setDragLists(null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTaskId(null);
    if (!over) {
      setDragLists(null);
      return;
    }
    const lists = dragLists ?? baseLists;
    const finalLists = projectDragEnd(lists, String(active.id), String(over.id));
    const placement = dropPlacement(finalLists, String(active.id));
    if (!placement || listsEqual(finalLists, baseLists)) {
      setDragLists(null);
      return;
    }
    // Hold the projection through the mutation round-trip, then hand back to
    // the reactive board (which now reflects the new order).
    setDragLists(finalLists);
    void (async () => {
      try {
        await reorderTask({
          projectId: board.project._id as any,
          phaseId: placement.phaseId as any,
          taskId: active.id as any,
          ...(placement.beforeTaskId
            ? { beforeTaskId: placement.beforeTaskId as any }
            : {}),
        });
      } catch (error) {
        toast(
          error instanceof Error ? error.message : "Could not reorder task",
          "error",
        );
      } finally {
        setDragLists(null);
      }
    })();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-5 p-4 desk:p-5">
        {activePhases.map((phase) => (
          <PhaseSection
            key={phase._id}
            phase={phase}
            phaseTasks={tasksForPhase(phase)}
            sortedIncompleteTasks={sortedIncompleteFor(phase)}
            busyTaskId={busyTaskId}
            approvalsByTask={approvalsByTask}
            onSelect={onSelect}
            onStart={onStart}
            onComplete={onComplete}
          />
        ))}

        <Button
          className="w-full border-dashed"
          onClick={() =>
            void createPhase({
              projectId: board.project._id as any,
              title: `Phase ${phases.length + 1}`,
            })
          }
        >
          <Plus size={15} aria-hidden /> Add phase
        </Button>

        {completedPhases.length ? (
          // Same treatment as completed tasks inside a phase: one unobtrusive
          // details row, closed by default. <details> keeps its children
          // mounted while closed, so expanding never remounts the phase rows.
          <details className="rounded-xl border bg-background/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-bold text-muted-foreground">
              Completed phases ({completedPhases.length})
            </summary>
            <div className="mt-2 grid gap-2 border-t pt-2">
              {completedPhases.map((phase) => (
                <PhaseSection
                  key={phase._id}
                  phase={phase}
                  phaseTasks={tasksForPhase(phase)}
                  sortedIncompleteTasks={sortedIncompleteFor(phase)}
                  busyTaskId={busyTaskId}
                  approvalsByTask={approvalsByTask}
                  onSelect={onSelect}
                  onStart={onStart}
                  onComplete={onComplete}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskRow
            task={activeTask}
            busy={false}
            pendingApprovals={approvalsByTask[activeTask._id] ?? 0}
            onSelect={() => {}}
            onStart={() => {}}
            onComplete={() => {}}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SidePanel({
  board,
  view,
  onView,
  busyTaskId,
  approvalsByTask,
  pendingApprovalTotal,
  onSelect,
  onStart,
  onComplete,
}: {
  board: AnyRecord;
  view: ProjectView;
  onView: (view: ProjectView) => void;
  busyTaskId: string | null;
  approvalsByTask: Record<string, number>;
  pendingApprovalTotal: number;
  onSelect: (task: AnyRecord) => void;
  onStart: (task: AnyRecord) => void;
  onComplete: (task: AnyRecord) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-secondary/35">
      <div
        className="flex border-b bg-card px-3 pt-3"
        role="tablist"
        aria-label="Project details"
      >
        {panelTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={view === tab.key}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-bold text-muted-foreground",
              view === tab.key && "border-primary text-foreground",
            )}
            onClick={() => onView(tab.key)}
          >
            {tab.label}
            {tab.key === "plan" && pendingApprovalTotal > 0 ? (
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold leading-[18px] text-white"
                title={`${pendingApprovalTotal} pending approval${pendingApprovalTotal === 1 ? "" : "s"}`}
              >
                {pendingApprovalTotal}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "overview" ? (
          <ProjectOverview project={board.project} />
        ) : null}
        {view === "plan" ? (
          <ProjectPlan
            board={board}
            busyTaskId={busyTaskId}
            approvalsByTask={approvalsByTask}
            onSelect={onSelect}
            onStart={onStart}
            onComplete={onComplete}
          />
        ) : null}
        {view === "notes" ? <ProjectNotesPad project={board.project} /> : null}
        {view === "library" ? (
          <div className="p-4">
            <ProjectLibrarySection projectId={board.project._id} alwaysOpen />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function ProjectBoardContent({ projectId }: { projectId: string }) {
  const viewerReady = useViewerReady();
  const board = useQuery(
    api.projects.projectBoardForViewer,
    viewerReady ? { projectId: projectId as any } : "skip",
  ) as AnyRecord | null | undefined;
  // One reactive approvals feed powers the whole surface: chat notices,
  // the task panel card, and the board indicators. No polling — Convex
  // pushes the pending → settled transition to every consumer at once.
  const approvalsRaw = useQuery(
    api.agentWorkbench.approvalsForProjectForViewer,
    viewerReady ? { projectId: projectId as any } : "skip",
  ) as AnyRecord[] | undefined;
  const approvals = useMemo(() => approvalsRaw ?? [], [approvalsRaw]);
  const ensurePhases = useMutation(api.projects.ensureProjectPhasesForViewer);
  const setExecState = useMutation(api.projects.setTaskExecutionStateForViewer);
  const executeTask = useMutation(api.agentWorkbench.executeTaskForViewer);
  const executionConfig = useQuery(
    api.agentWorkbench.projectExecutionConfigForViewer,
    viewerReady ? { projectId: projectId as any } : "skip",
  ) as AnyRecord | null | undefined;
  const updateProject = useMutation(api.projects.updateProjectForViewer);
  const toast = useToast();
  const [view, setView] = useState<ProjectView>("overview");
  // A selected Plan task swaps the chat's slot for its detail panel; the chat
  // stays mounted underneath so its draft and scroll position survive.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Task-row actions track WHICH task is busy so only the clicked row's
  // button disables; the global `busy` stays for the settings dialog.
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [taskHarness, setTaskHarness] = useState<"claude" | "codex">("claude");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectKind, setProjectKind] = useState("general");
  const [projectSummary, setProjectSummary] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [vercelUrl, setVercelUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [assetsFolderPath, setAssetsFolderPath] = useState("");
  const [outputFolderPath, setOutputFolderPath] = useState("");
  const ensured = useRef(false);

  useEffect(() => {
    if (executionConfig?.preferredHarness) setTaskHarness(executionConfig.preferredHarness);
  }, [executionConfig?.preferredHarness]);

  useEffect(() => {
    if (!board || board.phases?.length || ensured.current) return;
    ensured.current = true;
    void ensurePhases({ projectId: projectId as any }).catch((error) => {
      ensured.current = false;
      console.error("could not initialize project phases", error);
    });
  }, [board, ensurePhases, projectId]);

  // Drop the selection when the task disappears from the board (e.g. it was
  // deleted elsewhere) so the panel never renders a stale record.
  useEffect(() => {
    if (!selectedTaskId || !board) return;
    const exists = (board.tasks ?? []).some(
      (task: AnyRecord) => task._id === selectedTaskId,
    );
    if (!exists) setSelectedTaskId(null);
  }, [board, selectedTaskId]);

  const activeTasks = useMemo(() => {
    const tasks: AnyRecord[] = board?.tasks ?? [];
    const byId = new Map(tasks.map((task) => [task._id, task]));
    const ordered = (board?.phases ?? []).flatMap((phase: AnyRecord) =>
      (phase.taskIds ?? [])
        .map((taskId: string) => byId.get(taskId))
        .filter(Boolean),
    );
    const phaseTaskIds = new Set(ordered.map((task: AnyRecord) => task._id));
    ordered.push(...tasks.filter((task) => !phaseTaskIds.has(task._id)));
    return ordered.filter(
      (task: AnyRecord) => task.executionState !== "cancelled",
    );
  }, [board?.phases, board?.tasks]);
  const taskMoments = useMemo(() => buildTaskMoments(activeTasks), [activeTasks]);
  const approvalsByTask = useMemo(
    () => pendingApprovalsByTask(approvals),
    [approvals],
  );
  const pendingApprovalTotal = useMemo(
    () => pendingApprovalCount(approvals),
    [approvals],
  );

  if (board === undefined)
    return (
      <div className="p-6">
        <LoadingRow label="Loading project…" />
      </div>
    );
  if (!board)
    return (
      <div className="p-6">
        <Card>Project not found.</Card>
      </div>
    );

  const selectedTask =
    (board.tasks ?? []).find(
      (task: AnyRecord) => task._id === selectedTaskId,
    ) ?? null;

  const openProjectSettings = () => {
    const project = board.project;
    setProjectTitle(project.title ?? "");
    setProjectKind(project.kind ?? "general");
    setProjectSummary(project.summary ?? "");
    setRepoUrl(project.repoUrl ?? "");
    setVercelUrl(project.vercelUrl ?? "");
    setLiveUrl(project.liveUrl ?? "");
    setBaseBranch(project.defaultBaseBranch ?? "");
    setLocalPath(project.localPath ?? "");
    setAssetsFolderPath(project.assetsFolderPath ?? "");
    setOutputFolderPath(project.outputFolderPath ?? "");
    setSettingsOpen(true);
  };

  const saveProjectSettings = async () => {
    if (!projectTitle.trim()) {
      toast("Project title cannot be empty.", "error");
      return;
    }
    setBusy(true);
    try {
      await updateProject({
        projectId: projectId as any,
        title: projectTitle,
        kind: projectKind as any,
        summary: projectSummary,
        repoUrl,
        vercelUrl,
        liveUrl,
        defaultBaseBranch: baseBranch,
        localPath,
        assetsFolderPath,
        outputFolderPath,
      } as any);
      toast("Project updated.", "success");
      setSettingsOpen(false);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not update project",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const setProjectArchived = async (archived: boolean) => {
    if (
      archived &&
      !window.confirm(
        `Archive "${board.project.title}"? You can restore it from Settings.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await updateProject({
        projectId: projectId as any,
        status: archived ? "archived" : "planned",
      } as any);
      toast(archived ? "Project archived." : "Project restored.", "success");
      setSettingsOpen(false);
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : archived
            ? "Could not archive project"
            : "Could not restore project",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const startTask = async (task: AnyRecord) => {
    if (busyTaskId) return;
    setBusyTaskId(task._id);
    try {
      if (task.ownerType === "agent") {
        if (task.executionState !== "ready") {
          await setExecState({
            taskId: task._id as any,
            executionState: "ready",
          });
        }
        await executeTask({ taskId: task._id as any, harness: taskHarness });
        toast(`Task started with ${taskHarness === "codex" ? "Codex" : "Claude"}.`, "success");
      } else {
        await setExecState({
          taskId: task._id as any,
          executionState: "in_progress",
        });
        toast("Task marked in progress.", "success");
      }
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not start task",
        "error",
      );
    } finally {
      setBusyTaskId(null);
    }
  };

  const completeTask = async (task: AnyRecord) => {
    if (busyTaskId) return;
    setBusyTaskId(task._id);
    try {
      await setExecState({ taskId: task._id as any, executionState: "done" });
      toast("Task complete. The next task is ready.", "success");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not complete task",
        "error",
      );
    } finally {
      setBusyTaskId(null);
    }
  };

  const folderBase = localPath.trim().replace(/[\\/]+$/, "");

  return (
    <LiveGate>
      <>
        <div className="flex min-h-[calc(100dvh-92px)] flex-col desk:h-screen desk:min-h-0">
        <header className="flex items-center gap-3 border-b bg-card px-4 py-3 desk:px-5">
          <Link
            href="/projects"
            className="grid size-9 place-items-center rounded-lg border text-muted-foreground hover:text-foreground"
            aria-label="Back to projects"
          >
            <ArrowLeft size={17} aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate font-bold">{board.project.title}</p>
            <p className="m-0 text-xs text-muted-foreground desk:hidden">
              {board.progress.done}/{board.progress.total} tasks complete
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 text-xs text-muted-foreground desk:flex">
              <Sparkles size={14} className="text-primary" aria-hidden />{" "}
              {board.progress.done}/{board.progress.total} complete
            </div>
            {executionConfig?.enabled ? (
              <Select
                className="w-[9.5rem] shrink-0"
                value={taskHarness}
                onChange={(event) => setTaskHarness(event.target.value as "claude" | "codex")}
                aria-label="Task harness"
                title="Harness used when starting agent tasks"
              >
                <option value="claude">Tasks: Claude</option>
                <option value="codex">Tasks: Codex</option>
              </Select>
            ) : null}
            <Button small onClick={openProjectSettings} title="Project settings">
              <Settings2 size={15} aria-hidden />
              <span className="hidden desk:inline">Settings</span>
            </Button>
          </div>
        </header>

        <nav
          className="grid grid-cols-5 border-b bg-card desk:hidden"
          aria-label="Project views"
        >
          {mobileTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 border-b-2 border-transparent text-[11px] font-bold text-muted-foreground",
                view === tab.key && "border-primary text-primary",
              )}
              onClick={() => setView(tab.key)}
            >
              <span className="relative">
                <tab.icon size={16} aria-hidden />
                {tab.key === "plan" && pendingApprovalTotal > 0 ? (
                  <span
                    className="absolute -right-1.5 -top-1 size-2 rounded-full bg-gold"
                    aria-label={`${pendingApprovalTotal} pending approvals`}
                  />
                ) : null}
              </span>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="hidden min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] desk:grid">
          {/* The detail panel overlays the chat instead of replacing it so the
              chat keeps its draft text and scroll position while hidden. */}
          <div className="relative flex min-h-0 min-w-0 flex-col border-r">
            <ProjectChatWorkspace
              projectId={projectId}
              taskMoments={taskMoments}
              runApprovals={approvals}
              onOpenTask={setSelectedTaskId}
              className="min-h-0 flex-1"
            />
            {selectedTask ? (
              <TaskDetailPanel
                task={selectedTask}
                busy={busyTaskId === selectedTask._id}
                onBack={() => setSelectedTaskId(null)}
                onStart={() => void startTask(selectedTask)}
                onComplete={() => void completeTask(selectedTask)}
                approvals={approvals}
                className="absolute inset-0 z-10"
              />
            ) : null}
          </div>
          <SidePanel
            board={board}
            view={view === "chat" ? "overview" : view}
            onView={setView}
            busyTaskId={busyTaskId}
            approvalsByTask={approvalsByTask}
            pendingApprovalTotal={pendingApprovalTotal}
            onSelect={(task) => setSelectedTaskId(task._id)}
            onStart={(task) => void startTask(task)}
            onComplete={(task) => void completeTask(task)}
          />
        </div>

        <div className="min-h-0 flex-1 desk:hidden">
          {/* On mobile the detail panel takes over the active view; mobile
              tabs unmount the chat anyway, so there is no draft to protect. */}
          {selectedTask ? (
            <TaskDetailPanel
              task={selectedTask}
              busy={busyTaskId === selectedTask._id}
              onBack={() => setSelectedTaskId(null)}
              onStart={() => void startTask(selectedTask)}
              onComplete={() => void completeTask(selectedTask)}
              approvals={approvals}
              className="h-[calc(100dvh-204px)]"
            />
          ) : (
            <>
              {view === "chat" ? (
                <ProjectChatWorkspace
                  projectId={projectId}
                  taskMoments={taskMoments}
                  runApprovals={approvals}
                  onOpenTask={setSelectedTaskId}
                  className="h-[calc(100dvh-204px)]"
                />
              ) : null}
              {view === "overview" ? (
                <ProjectOverview project={board.project} />
              ) : null}
              {view === "plan" ? (
                <ProjectPlan
                  board={board}
                  busyTaskId={busyTaskId}
                  approvalsByTask={approvalsByTask}
                  onSelect={(task) => setSelectedTaskId(task._id)}
                  onStart={(task) => void startTask(task)}
                  onComplete={(task) => void completeTask(task)}
                />
              ) : null}
              {view === "notes" ? (
                <ProjectNotesPad project={board.project} />
              ) : null}
              {view === "library" ? (
                <div className="p-4">
                  <ProjectLibrarySection projectId={projectId} alwaysOpen />
                </div>
              ) : null}
            </>
          )}
        </div>
        </div>

        <Dialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Project settings"
        >
          <div className="grid gap-4">
            <Field label="Project name">
              <TextInput
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Description">
              <TextArea
                value={projectSummary}
                onChange={(event) => setProjectSummary(event.target.value)}
              />
            </Field>
            <Field label="Project type">
              <Select
                value={projectKind}
                onChange={(event) => setProjectKind(event.target.value)}
              >
                <option value="general">General</option>
                <option value="code">Code project</option>
              </Select>
            </Field>

            <div className="border-t pt-4">
              <h3 className="mb-3 text-sm">Links</h3>
              <div className="grid gap-3">
                <Field label="GitHub repository URL">
                  <TextInput
                    type="url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/you/repository"
                  />
                </Field>
                <Field label="Vercel project URL">
                  <TextInput
                    type="url"
                    value={vercelUrl}
                    onChange={(event) => setVercelUrl(event.target.value)}
                    placeholder="https://vercel.com/you/project"
                  />
                </Field>
                <Field label="Live URL">
                  <TextInput
                    type="url"
                    value={liveUrl}
                    onChange={(event) => setLiveUrl(event.target.value)}
                    placeholder="https://example.com"
                  />
                </Field>
                {projectKind === "code" ? (
                  <Field label="Default base branch">
                    <TextInput
                      value={baseBranch}
                      onChange={(event) => setBaseBranch(event.target.value)}
                      placeholder="main"
                    />
                  </Field>
                ) : null}
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-3 text-sm">Folders</h3>
              <div className="grid gap-3">
                <Field label="Project local folder">
                  <TextInput
                    value={localPath}
                    onChange={(event) => setLocalPath(event.target.value)}
                    placeholder="/Users/you/projects/project"
                  />
                </Field>
                <Field label="Library folder">
                  <TextInput
                    value={assetsFolderPath}
                    onChange={(event) => setAssetsFolderPath(event.target.value)}
                    placeholder={folderBase ? `${folderBase}/_library` : "Set the project folder first"}
                    disabled={!folderBase}
                  />
                </Field>
                <Field label="Output folder">
                  <TextInput
                    value={outputFolderPath}
                    onChange={(event) => setOutputFolderPath(event.target.value)}
                    placeholder={folderBase ? `${folderBase}/_output` : "Set the project folder first"}
                    disabled={!folderBase}
                  />
                </Field>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {board.project.status === "archived" ? (
                <Button disabled={busy} onClick={() => void setProjectArchived(false)}>
                  <ArchiveRestore size={15} aria-hidden /> Restore project
                </Button>
              ) : (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void setProjectArchived(true)}
                >
                  <Archive size={15} aria-hidden /> Archive project
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button disabled={busy} onClick={() => setSettingsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || !projectTitle.trim()}
                  onClick={() => void saveProjectSettings()}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </Dialog>
      </>
    </LiveGate>
  );
}
