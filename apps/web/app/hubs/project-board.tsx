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
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../lib/skippy-api";
import { ProjectChatWorkspace } from "../components/chat-panel";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  LoadingRow,
  ProgressBar,
  Select,
  TextArea,
  TextInput,
  useToast,
} from "../components";
import { LiveGate } from "../live-auth";
import { ProjectLibrarySection } from "./project-library";
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

function PhaseDescription({ phase }: { phase: AnyRecord }) {
  const updatePhase = useMutation(api.projects.updatePhaseForViewer);
  const [draft, setDraft] = useState(phase.descriptionMd ?? "");
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focused.current) setDraft(phase.descriptionMd ?? "");
  }, [phase.descriptionMd]);

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
      className="min-h-20 w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-muted-foreground transition-colors placeholder:text-muted-foreground/55 hover:border-border focus:border-primary/55 focus:bg-background focus:outline-none"
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
  featured,
  busy,
  onStart,
  onComplete,
  onDragStart,
  onDrop,
}: {
  task: AnyRecord;
  featured: boolean;
  busy: boolean;
  onStart: () => void;
  onComplete: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const state = displayState(task);
  const completed = state === "Completed";
  const inProgress = state === "In Progress";

  if (completed) {
    return (
      <article
        draggable
        onDragStart={onDragStart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-sm text-muted-foreground hover:border-border"
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
      className={cn(
        "rounded-xl border p-3 transition-colors",
        featured
          ? "border-primary/55 bg-primary/[0.07] shadow-sm"
          : "border-border bg-background/40",
      )}
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
            {inProgress ? <Badge tone="gold">In Progress</Badge> : null}
          </div>
          {featured && (task.executionBrief || task.description) ? (
            <p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {task.executionBrief || task.description}
            </p>
          ) : null}
          {featured ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!inProgress ? (
                <Button
                  small
                  variant="primary"
                  disabled={busy}
                  onClick={onStart}
                >
                  <Play size={14} aria-hidden />{" "}
                  {task.ownerType === "agent"
                    ? "Start task"
                    : "Mark in progress"}
                </Button>
              ) : null}
              {task.ownerType !== "agent" && inProgress ? (
                <Button
                  small
                  variant="primary"
                  disabled={busy}
                  onClick={onComplete}
                >
                  <Check size={14} aria-hidden /> Mark complete
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
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

function ProjectPlan({
  board,
  featuredTask,
  busy,
  onStart,
  onComplete,
}: {
  board: AnyRecord;
  featuredTask: AnyRecord | null;
  busy: boolean;
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
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-xl">What’s next</h2>
        <span className="text-sm font-bold">
          {board.progress.percent}% complete
        </span>
      </div>
      <ProgressBar value={board.progress.percent} />
      {featuredTask ? (
        <div className="mt-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-primary">
            Next in the plan
          </p>
          <p className="mb-1 font-bold">{featuredTask.title}</p>
          <p className="m-0 text-sm text-muted-foreground">
            {featuredTask.executionBrief ||
              featuredTask.description ||
              "This is the first unfinished task in the ordered plan."}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-sm font-bold text-green">
          <CheckCircle2 size={17} aria-hidden /> Project plan complete
        </div>
      )}

      {phases.map((phase) => {
        const phaseTasks = tasks.filter((task) => task.phaseId === phase._id);
        const completedTasks = phaseTasks.filter(
          (task) => displayState(task) === "Completed",
        );
        const incompleteTasks = phaseTasks.filter(
          (task) => displayState(task) !== "Completed",
        );
        const completeCount = completedTasks.length;
        return (
          <section key={phase._id}>
            <div className="flex items-start justify-between gap-3 pt-2 mb-2">
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Phase {phase.orderNum + 1}
                </p>
                <h2 className="m-0 text-xl">{phase.title}</h2>
              </div>
              <span className="mt-1 text-xs text-muted-foreground">
                {completeCount}/{phaseTasks.length}
              </span>
            </div>
            <PhaseDescription phase={phase} />
            <div className="mt-2 grid gap-2">
              {incompleteTasks.map((task) => (
                <TaskRow
                  key={task._id}
                  task={task}
                  featured={featuredTask?._id === task._id}
                  busy={busy}
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
                        featured={false}
                        busy={busy}
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
      })}

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
  featuredTask,
  busy,
  onStart,
  onComplete,
}: {
  board: AnyRecord;
  view: ProjectView;
  onView: (view: ProjectView) => void;
  featuredTask: AnyRecord | null;
  busy: boolean;
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
              "border-b-2 border-transparent px-3 py-2.5 text-sm font-bold text-muted-foreground",
              view === tab.key && "border-primary text-foreground",
            )}
            onClick={() => onView(tab.key)}
          >
            {tab.label}
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
            featuredTask={featuredTask}
            busy={busy}
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
  const ensurePhases = useMutation(api.projects.ensureProjectPhasesForViewer);
  const setExecState = useMutation(api.projects.setTaskExecutionStateForViewer);
  const executeTask = useMutation(api.agentWorkbench.executeTaskForViewer);
  const updateProject = useMutation(api.projects.updateProjectForViewer);
  const toast = useToast();
  const [view, setView] = useState<ProjectView>("overview");
  const [busy, setBusy] = useState(false);
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
  const featuredTask =
    activeTasks.find((task: AnyRecord) => displayState(task) !== "Completed") ??
    null;
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
    setBusy(true);
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
      setBusy(false);
    }
  };

  const completeTask = async (task: AnyRecord) => {
    setBusy(true);
    try {
      await setExecState({ taskId: task._id as any, executionState: "done" });
      toast("Task complete. The next task is ready.", "success");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not complete task",
        "error",
      );
    } finally {
      setBusy(false);
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
              {featuredTask ? `Next: ${featuredTask.title}` : "Plan complete"}
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
              <tab.icon size={16} aria-hidden /> {tab.label}
            </button>
          ))}
        </nav>

        <div className="hidden min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] desk:grid">
          <ProjectChatWorkspace
            projectId={projectId}
            taskMoments={taskMoments}
            className="border-r"
          />
          <SidePanel
            board={board}
            view={view === "chat" ? "overview" : view}
            onView={setView}
            featuredTask={featuredTask}
            busy={busy}
            onStart={(task) => void startTask(task)}
            onComplete={(task) => void completeTask(task)}
          />
        </div>

        <div className="min-h-0 flex-1 desk:hidden">
          {view === "chat" ? (
            <ProjectChatWorkspace
              projectId={projectId}
              taskMoments={taskMoments}
              className="h-[calc(100dvh-204px)]"
            />
          ) : null}
          {view === "overview" ? (
            <ProjectOverview project={board.project} />
          ) : null}
          {view === "plan" ? (
            <ProjectPlan
              board={board}
              featuredTask={featuredTask}
              busy={busy}
              onStart={(task) => void startTask(task)}
              onComplete={(task) => void completeTask(task)}
            />
          ) : null}
          {view === "library" ? (
            <div className="p-4">
              <ProjectLibrarySection projectId={projectId} alwaysOpen />
            </div>
          ) : null}
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
