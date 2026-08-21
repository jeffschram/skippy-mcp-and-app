"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import {
  pendingApprovalCount,
  pendingApprovalsByTask,
} from "../../lib/approvals";
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
  phaseCompletion,
} from "./project-plan-helpers";
import { ProjectLibrarySection } from "./project-library";
import { TaskDetailPanel } from "./task-detail";
import { useViewerReady } from "./use-viewer";

type AnyRecord = Record<string, any>;
type ProjectView = "chat" | "overview" | "plan" | "library";

const panelTabs: Array<{ key: Exclude<ProjectView, "chat">; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "plan", label: "Plan" },
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
  onDragStart,
  onDrop,
}: {
  task: AnyRecord;
  busy: boolean;
  /** Pending run approvals waiting on the owner for this task. */
  pendingApprovals?: number;
  onSelect: () => void;
  onStart: () => void;
  onComplete: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const state = displayState(task);
  const completed = state === "Completed";
  const inProgress = state === "In Progress";
  // Every actionable row carries its own start affordance; owner tasks that
  // are underway swap it for a complete affordance. Agent tasks in progress
  // show only the badge (the workspace run owns their lifecycle).
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
        draggable
        onDragStart={onDragStart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={onSelect}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-sm text-muted-foreground hover:border-border"
      >
        <GripVertical
          className="cursor-grab opacity-35"
          size={15}
          aria-hidden
        />
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
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onClick={onSelect}
      className="cursor-pointer rounded-xl border border-border bg-background/40 p-3 transition-colors hover:border-primary/45"
    >
      <div className="flex items-start gap-2.5">
        <GripVertical
          className="mt-1 cursor-grab text-muted-foreground/55"
          size={16}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 min-w-0 flex-[1_1_180px] whitespace-normal break-words text-[13px] font-semibold leading-snug">
              {task.title}
            </h3>
            {task.ownerType === "agent" ? (
              <Badge tone="blue">Agent</Badge>
            ) : null}
            {pendingApprovals > 0 ? (
              // A waiting run must be discoverable without scrolling chat:
              // the gate badge outranks the generic "In Progress" state.
              <Badge tone="gold">
                <ShieldAlert size={12} aria-hidden /> Needs approval
              </Badge>
            ) : inProgress ? (
              <Badge tone="gold">In Progress</Badge>
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
    </article>
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

function PhaseSection({
  phase,
  phaseTasks,
  busyTaskId,
  approvalsByTask,
  onSelect,
  onStart,
  onComplete,
  setDraggingId,
  moveBefore,
}: {
  phase: AnyRecord;
  phaseTasks: AnyRecord[];
  busyTaskId: string | null;
  approvalsByTask: Record<string, number>;
  onSelect: (task: AnyRecord) => void;
  onStart: (task: AnyRecord) => void;
  onComplete: (task: AnyRecord) => void;
  setDraggingId: (taskId: string | null) => void;
  moveBefore: (phaseId: string, beforeTaskId?: string) => Promise<void>;
}) {
  const completion = phaseCompletion(phaseTasks);
  // Completed phases default collapsed so live work sits above the fold.
  // "expanded" only matters while the phase is complete; a reopened or new
  // task flips `completion` to "active" and the full rendering returns on
  // its own, no state reset needed.
  const [expanded, setExpanded] = useState(false);
  const completedTasks = phaseTasks.filter(
    (task) => displayState(task) === "Completed",
  );
  const incompleteTasks = phaseTasks.filter(
    (task) => displayState(task) !== "Completed",
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
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Phase {phase.orderNum + 1}
            </p>
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
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Phase {phase.orderNum + 1}
          </p>
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
      <div className="mt-2 grid gap-2">
        {incompleteTasks.map((task) => (
          <TaskRow
            key={task._id}
            task={task}
            busy={busyTaskId === task._id}
            pendingApprovals={approvalsByTask[task._id] ?? 0}
            onSelect={() => onSelect(task)}
            onStart={() => onStart(task)}
            onComplete={() => onComplete(task)}
            onDragStart={(event) => {
              setDraggingId(task._id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", task._id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              void moveBefore(phase._id, task._id);
            }}
          />
        ))}
        <button
          type="button"
          className="flex min-h-10 items-center justify-center rounded-lg border border-dashed text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void moveBefore(phase._id);
          }}
        >
          Drop here to move to the end of this phase
        </button>
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
                  onDragStart={(event) => {
                    setDraggingId(task._id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", task._id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void moveBefore(phase._id, task._id);
                  }}
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const tasks: AnyRecord[] = board.tasks ?? [];
  const phases: AnyRecord[] = board.phases ?? [];

  const moveBefore = async (phaseId: string, beforeTaskId?: string) => {
    if (!draggingId || draggingId === beforeTaskId) return;
    try {
      await reorderTask({
        projectId: board.project._id as any,
        phaseId: phaseId as any,
        taskId: draggingId as any,
        ...(beforeTaskId ? { beforeTaskId: beforeTaskId as any } : {}),
      });
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not reorder task",
        "error",
      );
    } finally {
      setDraggingId(null);
    }
  };

  return (
    <div className="space-y-5 p-4 desk:p-5">
      {phases.map((phase) => (
        <PhaseSection
          key={phase._id}
          phase={phase}
          phaseTasks={tasks.filter((task) => task.phaseId === phase._id)}
          busyTaskId={busyTaskId}
          approvalsByTask={approvalsByTask}
          onSelect={onSelect}
          onStart={onStart}
          onComplete={onComplete}
          setDraggingId={setDraggingId}
          moveBefore={moveBefore}
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
    </div>
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
  const taskMoments = useMemo(() => {
    const moments: AnyRecord[] = [];
    for (const task of activeTasks) {
      const state = displayState(task);
      const startedAt =
        task.agentRequestedAt ??
        task.startedAt ??
        (state === "In Progress" ? task.updatedAt : undefined);
      if (startedAt) {
        moments.push({
          key: `task:${task._id}:started`,
          timestamp: startedAt,
          state: "in_progress",
          task,
        });
      }
      if (state === "Completed") {
        moments.push({
          key: `task:${task._id}:completed`,
          timestamp: task.completedAt ?? task.updatedAt,
          state: "completed",
          task,
        });
      }
    }
    return moments;
  }, [activeTasks]);
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
        await executeTask({ taskId: task._id as any });
        toast("Task started in the workspace.", "success");
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
            <p className="m-0 text-xs text-muted-foreground">
              {board.progress.done}/{board.progress.total} tasks complete
            </p>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground desk:flex">
            <Sparkles size={14} className="text-primary" aria-hidden />{" "}
            {board.progress.done}/{board.progress.total} complete
          </div>
          <Button small onClick={openProjectSettings} title="Project settings">
            <Settings2 size={15} aria-hidden />
            <span className="hidden desk:inline">Settings</span>
          </Button>
        </header>

        <nav
          className="grid grid-cols-4 border-b bg-card desk:hidden"
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
