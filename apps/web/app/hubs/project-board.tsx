"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Ban,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  Folder,
  GitBranch,
  GitPullRequest,
  GripVertical,
  Pencil,
  Plus,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { isValidFolderPathFormat } from "@skippy/shared";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import {
  ActivityBar,
  Badge,
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  LoadingRow,
  ProgressBar,
  Select,
  Tabs,
  TextArea,
  TextInput,
  useToast,
} from "../components";
import { EXECUTION_COLUMNS, executionStateTone, taskStatusTone, titleCase } from "../../lib/display";
import { useViewerReady } from "./use-viewer";
import { ProjectLibrarySection, TaskAttachments, useProjectFileUploader } from "./project-library";
import { checkProjectFile, formatFileSize, PROJECT_FILE_ACCEPT } from "./project-library-helpers";
import boardStyles from "./board.module.css";

type AnyRecord = Record<string, any>;

// States where the task hasn't been executed yet — brief is editable, no result capture.
const PRE_EXECUTION = new Set(["unplanned", "briefed", "ready", "blocked"]);
// States where recording a result makes sense.
const RESULT_STATES = new Set(["in_progress", "in_review"]);
// States the owner can abandon — running or completed work records its result instead.
const ABANDONABLE_STATES = new Set(["proposed", "unplanned", "briefed", "ready", "blocked"]);

/**
 * Text input for an assets/output folder override. Unset means "derived from
 * the project local folder" — the muted hint shows the derived default and a
 * reset affordance clears the override back to it.
 */
function FolderOverrideField({
  label,
  value,
  onChange,
  derivedDefault,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  derivedDefault: string | undefined;
  disabled: boolean;
}) {
  return (
    <Field label={label}>
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={derivedDefault ?? ""}
        disabled={disabled}
      />
      <span className="muted" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
        <span>{disabled ? "set the project local folder first" : `default: ${derivedDefault}`}</span>
        {!disabled && value ? (
          <button
            type="button"
            className="text-button"
            style={{ fontSize: 12 }}
            onClick={(event) => {
              event.preventDefault();
              onChange("");
            }}
          >
            Reset to default
          </button>
        ) : null}
      </span>
    </Field>
  );
}

function buildBriefText(task: AnyRecord, project?: AnyRecord): string {
  const lines = [`# ${task.title}`];
  if (project?.title) lines.push(`Project: ${project.title}`);
  if (project?.repoUrl) lines.push(`Repo: ${project.repoUrl}`);
  if (project?.localPath) lines.push(`Local folder: ${project.localPath}`);
  if (task.kind) lines.push(`Kind: ${task.kind}`);
  if (task.description) lines.push("", task.description);
  if (task.executionBrief) lines.push("", "## Brief", task.executionBrief);
  if (task.acceptanceCriteria?.length) {
    lines.push("", "## Acceptance criteria", ...task.acceptanceCriteria.map((c: string) => `- [ ] ${c}`));
  }
  return lines.join("\n");
}

export function ProjectBoardContent({ projectId }: { projectId: string }) {
  const viewerReady = useViewerReady();
  const board = useQuery(api.projects.projectBoardForViewer, viewerReady ? { projectId: projectId as any } : "skip") as
    | AnyRecord
    | null
    | undefined;
  const planProject = useAction(api.planning.planProject);
  const briefTaskProposal = useAction(api.planning.briefTaskProposal);
  const markDone = useMutation(api.knowledge.markTaskDoneForViewer);
  const createTaskProposal = useMutation(api.projects.createTaskProposalForViewer);
  const { uploadFiles: uploadProposalFiles } = useProjectFileUploader(projectId);
  const recordResult = useMutation(api.projects.recordTaskResultForViewer);
  const requestAgent = useMutation(api.projects.requestAgentForTaskForViewer);
  const setExecState = useMutation(api.projects.setTaskExecutionStateForViewer);
  const reorderTask = useMutation(api.projects.reorderTaskForViewer);
  const cancelTask = useMutation(api.projects.cancelTaskForViewer);
  const restoreTask = useMutation(api.projects.restoreTaskForViewer);
  const updateBrief = useMutation(api.projects.updateTaskBriefForViewer);
  const updateProject = useMutation(api.projects.updateProjectForViewer);
  const toast = useToast();

  const [planning, setPlanning] = useState(false);
  const [view, setView] = useState<"tasks" | "library">("tasks");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefingTaskIds, setBriefingTaskIds] = useState<Set<string>>(new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverState, setDragOverState] = useState<string | null>(null);

  // Stacked (mobile) board drag: native HTML drag events never fire for touch,
  // so the grip handle drives a pointer-event drag instead. `index` is the
  // insertion position among the target bucket's visible cards.
  const [touchDrag, setTouchDrag] = useState<{ taskId: string; fromState: string } | null>(null);
  const [touchDropTarget, setTouchDropTarget] = useState<{ state: string; index: number } | null>(null);

  // Abandon (cancel) flow: two-click confirm in the drawer + collapsed list below the board.
  const [abandonConfirming, setAbandonConfirming] = useState(false);
  const [abandonedOpen, setAbandonedOpen] = useState(false);

  // Brief editing
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [criteriaDraft, setCriteriaDraft] = useState("");

  // Proposal editing (proposed tasks: title + proposal text)
  const [editingProposal, setEditingProposal] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [proposalDraft, setProposalDraft] = useState("");

  // Task proposal dialog
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalText, setProposalText] = useState("");
  const [proposalKind, setProposalKind] = useState("coding");
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalFiles, setProposalFiles] = useState<File[]>([]);

  // Project settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pKind, setPKind] = useState("general");
  const [pRepo, setPRepo] = useState("");
  const [pBaseBranch, setPBaseBranch] = useState("");
  const [pFolder, setPFolder] = useState("");
  const [pAssets, setPAssets] = useState("");
  const [pOutput, setPOutput] = useState("");
  const [pSummary, setPSummary] = useState("");
  // Live base for the derived assets/output hints: the local-folder input,
  // trimmed with trailing slashes stripped (matches server normalization).
  const pFolderBase = useMemo(() => {
    const trimmed = pFolder.trim();
    return trimmed.replace(/[\\/]+$/, "") || trimmed;
  }, [pFolder]);

  const selected = board?.tasks?.find((task: AnyRecord) => task._id === selectedId) ?? null;
  const detail = useQuery(
    api.projects.getTaskBriefForViewer,
    viewerReady && selectedId ? { taskId: selectedId as any } : "skip",
  ) as AnyRecord | null | undefined;

  // The 'Confirm?' abandon state resets on its own after a moment.
  useEffect(() => {
    if (!abandonConfirming) return;
    const timer = window.setTimeout(() => setAbandonConfirming(false), 3500);
    return () => window.clearTimeout(timer);
  }, [abandonConfirming]);

  // Reset edit state whenever a different task is opened.
  useEffect(() => {
    setEditingBrief(false);
    setEditingProposal(false);
    setAbandonConfirming(false);
    if (selected) {
      setBriefDraft(selected.executionBrief ?? "");
      setCriteriaDraft((selected.acceptanceCriteria ?? []).join("\n"));
      setTitleDraft(selected.title ?? "");
      setProposalDraft(selected.description ?? "");
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = board?.project;
  const cancelledTasks: AnyRecord[] =
    board?.tasks?.filter((task: AnyRecord) => task.executionState === "cancelled") ?? [];
  const agentName = board?.agentName ?? "Agent";
  const ownerName = board?.ownerName ?? "Owner";
  const openSettings = () => {
    if (!project) return;
    setPKind(project.kind ?? "general");
    setPRepo(project.repoUrl ?? "");
    setPBaseBranch(project.defaultBaseBranch ?? "");
    setPFolder(project.localPath ?? "");
    setPAssets(project.assetsFolderPath ?? "");
    setPOutput(project.outputFolderPath ?? "");
    setPSummary(project.summary ?? "");
    setSettingsOpen(true);
  };

  const runPlan = async () => {
    setPlanning(true);
    try {
      const result = (await planProject({ projectId: projectId as any })) as AnyRecord;
      toast(`Skippy planned ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Planning failed", "error");
    } finally {
      setPlanning(false);
    }
  };

  const copyBrief = async (task: AnyRecord) => {
    try {
      await navigator.clipboard.writeText(buildBriefText(task, project));
      toast("Brief copied — paste it into your coding agent.", "success");
    } catch {
      toast("Could not copy to clipboard", "error");
    }
  };

  const proposeTask = async () => {
    const text = proposalText.trim();
    if (!text) {
      toast("Add proposal notes first.", "error");
      return;
    }
    setProposalBusy(true);
    try {
      const result = (await createTaskProposal({
        projectId: projectId as any,
        proposalText: text,
        kind: proposalKind as any,
      })) as { taskId: string };
      // Attachments upload after the task exists so they land task-scoped;
      // a failed upload never orphans the proposal (re-attach from the panel).
      let uploadNote = "";
      if (proposalFiles.length > 0 && result?.taskId) {
        const { done, failed } = await uploadProposalFiles(proposalFiles, result.taskId);
        uploadNote = failed > 0 ? ` ${done}/${done + failed} files attached.` : ` ${done} file${done === 1 ? "" : "s"} attached.`;
      }
      setProposalOpen(false);
      setProposalText("");
      setProposalKind("coding");
      setProposalFiles([]);
      toast(`Task proposed.${uploadNote}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not propose task", "error");
    } finally {
      setProposalBusy(false);
    }
  };

  // Track in-flight brief generation per task so the activity bar survives closing the sidepanel.
  const setTaskBriefing = (taskId: string, briefing: boolean) => {
    setBriefingTaskIds((previous) => {
      const next = new Set(previous);
      if (briefing) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  };

  // Briefing (transient, client-side) or executing (persistent, from board data) — both show the activity bar.
  const isTaskActive = (task: AnyRecord) => briefingTaskIds.has(task._id) || task.executionState === "in_progress";
  const activityLabel = (task: AnyRecord) => (briefingTaskIds.has(task._id) ? "Generating brief…" : "In progress…");

  const createBriefForTask = async (taskId: string) => {
    setBusy(true);
    setTaskBriefing(taskId, true);
    try {
      await briefTaskProposal({ taskId: taskId as any });
      toast("Brief created.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create brief", "error");
    } finally {
      setBusy(false);
      setTaskBriefing(taskId, false);
    }
  };

  const moveTo = async (taskId: string, state: string, taskOverride?: AnyRecord | null) => {
    const task = taskOverride ?? board?.tasks?.find((candidate: AnyRecord) => candidate._id === taskId);
    const briefing = task?.executionState === "proposed" && state === "briefed";
    setBusy(true);
    if (briefing) setTaskBriefing(taskId, true);
    try {
      if (briefing) {
        await briefTaskProposal({ taskId: taskId as any });
        toast("Brief created.", "success");
      } else {
        await setExecState({ taskId: taskId as any, executionState: state as any });
        toast(`Moved to ${titleCase(state)}.`, "info");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not move task", "error");
    } finally {
      setBusy(false);
      if (briefing) setTaskBriefing(taskId, false);
    }
  };

  const requestAgentForTask = async (task: AnyRecord) => {
    setBusy(true);
    try {
      await requestAgent({
        taskId: task._id as any,
        requestedHarness: agentName,
        agentRequestMessage: `Execute task ${task._id} (${task.title}) and record the result for review.`,
      });
      toast(`${agentName} requested.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : `Could not request ${agentName}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const abandonTask = async (taskId: string) => {
    setBusy(true);
    try {
      await cancelTask({ taskId: taskId as any });
      setAbandonConfirming(false);
      setSelectedId(null);
      toast("Task abandoned.", "info");
    } catch (error) {
      setAbandonConfirming(false);
      toast(error instanceof Error ? error.message : "Could not abandon task", "error");
    } finally {
      setBusy(false);
    }
  };

  const restoreAbandonedTask = async (taskId: string) => {
    setBusy(true);
    try {
      await restoreTask({ taskId: taskId as any });
      toast("Task restored to Proposed.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not restore task", "error");
    } finally {
      setBusy(false);
    }
  };

  const dropTaskInState = async (state: string) => {
    if (!draggedTaskId) return;
    const task = board?.tasks?.find((candidate: AnyRecord) => candidate._id === draggedTaskId);
    setDraggedTaskId(null);
    setDragOverState(null);
    if (!task || task.executionState === state) return;
    await moveTo(draggedTaskId, state, task);
  };

  // Which bucket/insertion-slot sits under the pointer, via hit test against
  // the bucket + card data attributes rendered below.
  const touchDropTargetAt = (x: number, y: number): { state: string; index: number } | null => {
    const bucketEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.(
      "[data-bucket-state]",
    ) as HTMLElement | null;
    if (!bucketEl?.dataset.bucketState) return null;
    const cards = Array.from(bucketEl.querySelectorAll<HTMLElement>("[data-task-id]"));
    let index = cards.length;
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i]?.getBoundingClientRect();
      if (rect && y < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    return { state: bucketEl.dataset.bucketState, index };
  };

  const startTouchDrag = (event: React.PointerEvent<HTMLElement>, task: AnyRecord) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setTouchDrag({ taskId: task._id, fromState: task.executionState });
    setTouchDropTarget(touchDropTargetAt(event.clientX, event.clientY));
  };

  const moveTouchDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!touchDrag) return;
    setTouchDropTarget(touchDropTargetAt(event.clientX, event.clientY));
    // Keep long stacked boards reachable: nudge the page near the viewport edges.
    const edge = 72;
    if (event.clientY < edge) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
  };

  const cancelTouchDrag = () => {
    setTouchDrag(null);
    setTouchDropTarget(null);
  };

  const endTouchDrag = () => {
    const drag = touchDrag;
    const target = touchDropTarget;
    cancelTouchDrag();
    if (!drag || !target) return;
    const bucketTasks: AnyRecord[] =
      board?.tasks?.filter((task: AnyRecord) => task.executionState === target.state) ?? [];
    if (target.state === drag.fromState) {
      const from = bucketTasks.findIndex((task) => task._id === drag.taskId);
      // Dropped back where it started — nothing to persist.
      if (from === -1 || target.index === from || target.index === from + 1) return;
    }
    if (target.state !== drag.fromState && drag.fromState === "proposed" && target.state === "briefed") {
      // Mirror desktop column drops: moving a proposal to Briefed generates the brief.
      void moveTo(drag.taskId, target.state);
      return;
    }
    let beforeTask = bucketTasks[target.index];
    if (beforeTask?._id === drag.taskId) beforeTask = bucketTasks[target.index + 1];
    void (async () => {
      try {
        await reorderTask({
          taskId: drag.taskId as any,
          projectId: projectId as any,
          executionState: target.state as any,
          beforeTaskId: (beforeTask?._id ?? undefined) as any,
        });
        if (target.state !== drag.fromState) toast(`Moved to ${titleCase(target.state)}.`, "info");
      } catch (error) {
        toast(error instanceof Error ? error.message : "Could not move task", "error");
      }
    })();
  };

  const saveBrief = async (taskId: string) => {
    setBusy(true);
    try {
      await updateBrief({
        taskId: taskId as any,
        executionBrief: briefDraft,
        acceptanceCriteria: criteriaDraft
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      } as any);
      toast("Brief updated.", "success");
      setEditingBrief(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save brief", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveProposal = async (taskId: string) => {
    if (!titleDraft.trim()) {
      toast("Title cannot be empty.", "error");
      return;
    }
    setBusy(true);
    try {
      await updateBrief({
        taskId: taskId as any,
        title: titleDraft,
        description: proposalDraft,
      } as any);
      toast("Proposal updated.", "success");
      setEditingProposal(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save proposal", "error");
    } finally {
      setBusy(false);
    }
  };

  const submitResult = async (taskId: string, markComplete: boolean) => {
    setBusy(true);
    try {
      await recordResult({
        taskId: taskId as any,
        resultSummary: resultSummary || undefined,
        resultUrl: resultUrl || undefined,
        markDone: markComplete,
      } as any);
      if (markComplete) await markDone({ taskId: taskId as any }).catch(() => undefined);
      toast(markComplete ? "Task completed." : "Result recorded for review.", "success");
      setSelectedId(null);
      setResultUrl("");
      setResultSummary("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not record result", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    // Mirror the server's format-only validation; existence checks are the
    // executing harness's job, never the app's.
    for (const [label, value] of [
      ["Library folder", pAssets],
      ["Output folder", pOutput],
    ] as const) {
      const trimmed = value.trim();
      if (trimmed && !isValidFolderPathFormat(trimmed)) {
        toast(`${label} must be an absolute path starting with '/', '~', or a drive letter.`, "error");
        return;
      }
    }
    setBusy(true);
    try {
      await updateProject({
        projectId: projectId as any,
        kind: pKind as any,
        repoUrl: pRepo,
        defaultBaseBranch: pBaseBranch,
        localPath: pFolder,
        assetsFolderPath: pAssets,
        outputFolderPath: pOutput,
        summary: pSummary,
      } as any);
      toast("Project updated.", "success");
      setSettingsOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update project", "error");
    } finally {
      setBusy(false);
    }
  };

  const archiveProject = async () => {
    if (!project) return;
    if (!window.confirm(`Archive "${project.title}"? It will disappear from primary project lists, but you can restore it from Settings.`)) {
      return;
    }
    setBusy(true);
    try {
      await updateProject({ projectId: projectId as any, status: "archived" } as any);
      toast("Project archived.", "success");
      setSettingsOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not archive project", "error");
    } finally {
      setBusy(false);
    }
  };

  const restoreProject = async () => {
    setBusy(true);
    try {
      await updateProject({ projectId: projectId as any, status: "planned" } as any);
      toast("Project restored.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not restore project", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LiveGate>
      {board === undefined ? (
        <Card>
          <LoadingRow label="Loading project board…" />
        </Card>
      ) : board === null ? (
        <Card>
          <EmptyState title="Project not found">
            <Link className="text-button" href="/projects">
              Back to projects
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <>
          <div style={{ marginBottom: 18 }}>
            <Link href="/projects" className="text-button compact" style={{ marginBottom: 14 }}>
              <ArrowLeft size={15} aria-hidden /> Projects
            </Link>
            <div className={boardStyles.projectHeader}>
              <div>
                <p className="eyebrow">{project.kind === "code" ? "Code project" : "Project"}</p>
                <h1>{project.title}</h1>
                {project.status === "archived" ? (
                  <p className="muted" style={{ maxWidth: 640 }}>
                    This project is archived. It is hidden from primary project lists until restored.
                  </p>
                ) : null}
                {project.summary ? <p className="muted" style={{ maxWidth: 640 }}>{project.summary}</p> : null}
                {project.repoUrl || project.localPath ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {project.repoUrl ? (
                      <a className="badge blue" href={project.repoUrl} target="_blank" rel="noreferrer" style={{ gap: 6 }}>
                        <GitBranch size={13} aria-hidden /> Repo
                      </a>
                    ) : null}
                    {project.localPath ? (
                      <span className="badge" style={{ gap: 6 }} title={project.localPath}>
                        <Folder size={13} aria-hidden /> {project.localPath}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className={boardStyles.projectActions}>
                <Button onClick={openSettings} title="Project settings">
                  <Settings2 size={16} aria-hidden /> Settings
                </Button>
                <Button onClick={() => setProposalOpen(true)}>
                  <Plus size={16} aria-hidden /> Propose task
                </Button>
                {board.tasks.length === 0 ? (
                  <Button variant="primary" onClick={() => void runPlan()} disabled={planning}>
                    <Sparkles size={17} aria-hidden />
                    {planning ? "Planning…" : "Plan with AI"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Tabs
              items={[
                { key: "tasks", label: "Tasks" },
                { key: "library", label: "Library" },
              ]}
              active={view}
              onChange={(key) => setView(key as "tasks" | "library")}
            />
          </div>

          {view === "library" ? (
            <ProjectLibrarySection projectId={projectId} alwaysOpen />
          ) : (
            <>
          {/* Progress */}
          <Card className={boardStyles.progressCard}>
            <div className={boardStyles.progressHead}>
              <strong>{board.progress.percent}% complete</strong>
              <span className="muted">
                {board.progress.done}/{board.progress.total} tasks · {board.progress.ready} ready · {board.progress.inReview} in
                review · {board.progress.blocked} blocked
              </span>
            </div>
            <ProgressBar value={board.progress.percent} tone={board.progress.percent === 100 ? "green" : "blue"} />
            {board.latestPlan?.summary ? (
              <p className="muted" style={{ margin: "12px 0 0", fontSize: 14 }}>
                <Sparkles size={13} aria-hidden style={{ verticalAlign: "-1px" }} /> {board.latestPlan.summary}
              </p>
            ) : null}
          </Card>

          {board.tasks.length === 0 ? (
            <Card>
              <EmptyState icon={<Sparkles size={20} aria-hidden />} title="No tasks yet">
                Click <strong>Plan with AI</strong> to decompose this project into executable task briefs you can hand to a
                coding agent.
              </EmptyState>
            </Card>
          ) : (
            <div className={boardStyles.board}>
              {EXECUTION_COLUMNS.map((column) => {
                const tasks = board.tasks.filter((task: AnyRecord) => task.executionState === column.key);
                return (
                  <div
                    key={column.key}
                    data-bucket-state={column.key}
                    className={`${boardStyles.column} ${dragOverState === column.key || touchDropTarget?.state === column.key ? boardStyles.columnDropTarget : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverState(column.key);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverState(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void dropTaskInState(column.key);
                    }}
                  >
                    <div className={boardStyles.columnHead}>
                      <span>{column.label}</span>
                      <span className={boardStyles.columnCount}>{tasks.length}</span>
                    </div>
                    <div className={boardStyles.columnBody}>
                      {tasks.map((task: AnyRecord, index: number) => (
                        <button
                          key={task._id}
                          data-task-id={task._id}
                          className={`${boardStyles.taskCard} ${task.ownerType === "owner" ? boardStyles.ownerTaskCard : ""} ${draggedTaskId === task._id || touchDrag?.taskId === task._id ? boardStyles.taskCardDragging : ""} ${touchDropTarget?.state === column.key && touchDropTarget.index === index ? boardStyles.dropBefore : ""} ${touchDropTarget?.state === column.key && touchDropTarget.index === tasks.length && index === tasks.length - 1 ? boardStyles.dropAfter : ""}`}
                          draggable
                          aria-grabbed={draggedTaskId === task._id}
                          aria-label={`${task.title}. ${task.ownerType === "owner" ? `${ownerName} owned task` : `${agentName} owned task`}.`}
                          onDragStart={(event) => {
                            setDraggedTaskId(task._id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", task._id);
                          }}
                          onDragEnd={() => {
                            setDraggedTaskId(null);
                            setDragOverState(null);
                          }}
                          onClick={() => setSelectedId(task._id)}
                          type="button"
                        >
                          <span className={boardStyles.taskTitle}>{task.title}</span>
                          <span className={boardStyles.taskMeta}>
                            {task.ownerType === "owner" ? <Badge tone="gold">{ownerName}</Badge> : null}
                            {task.kind ? (
                              <span className={boardStyles.metaSecondary}>
                                <Badge tone="neutral">{task.kind}</Badge>
                              </span>
                            ) : null}
                            {task.agentRequestStatus === "requested" ? (
                              <Badge tone="blue">Queued for {task.requestedHarness ?? agentName}</Badge>
                            ) : null}
                            {task.dependsOn?.length ? (
                              <span className={boardStyles.metaSecondary}>
                                <Badge tone="gold">{task.dependsOn.length} dep</Badge>
                              </span>
                            ) : null}
                            {task.resultUrl ? <Badge tone="green">result</Badge> : null}
                          </span>
                          {isTaskActive(task) ? <ActivityBar label={activityLabel(task)} /> : null}
                          <span
                            className={boardStyles.dragHandle}
                            aria-hidden
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => startTouchDrag(event, task)}
                            onPointerMove={moveTouchDrag}
                            onPointerUp={endTouchDrag}
                            onPointerCancel={cancelTouchDrag}
                          >
                            <GripVertical size={17} aria-hidden />
                          </span>
                        </button>
                      ))}
                      {tasks.length === 0 ? <p className={boardStyles.columnEmpty}>—</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {cancelledTasks.length > 0 ? (
            <div className={boardStyles.abandonedSection}>
              <button
                type="button"
                className={boardStyles.abandonedToggle}
                aria-expanded={abandonedOpen}
                onClick={() => setAbandonedOpen((open) => !open)}
              >
                {abandonedOpen ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                Abandoned ({cancelledTasks.length})
              </button>
              {abandonedOpen ? (
                <div className={boardStyles.abandonedList}>
                  {cancelledTasks.map((task: AnyRecord) => (
                    <div key={task._id} className={boardStyles.abandonedRow}>
                      <span className={boardStyles.abandonedTitle}>{task.title}</span>
                      {task.kind ? <Badge tone="neutral">{task.kind}</Badge> : null}
                      <Button
                        small
                        disabled={busy}
                        onClick={() => void restoreAbandonedTask(task._id)}
                        title="Restore to Proposed"
                        style={{ marginLeft: "auto" }}
                      >
                        <RotateCcw size={14} aria-hidden /> Restore
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
            </>
          )}

          <Drawer
            open={Boolean(selectedId)}
            onClose={() => setSelectedId(null)}
            eyebrow={selected ? titleCase(selected.executionState) : "Task"}
            title={selected?.title ?? "Task"}
            footer={
              selected ? (
                <>
                  {selected.executionState === "proposed" ? (
                    <Button variant="primary" disabled={busy} onClick={() => void createBriefForTask(selected._id)}>
                      <Sparkles size={16} aria-hidden /> Create Brief
                    </Button>
                  ) : (
                    <Button onClick={() => void copyBrief(selected)}>
                      <ClipboardCopy size={16} aria-hidden /> Copy brief
                    </Button>
                  )}
                  {selected.executionState === "briefed" ? (
                    <Button variant="primary" disabled={busy} onClick={() => void moveTo(selected._id, "ready")}>
                      Mark Ready
                    </Button>
                  ) : selected.executionState === "ready" && selected.ownerType === "agent" ? (
                    <Button
                      variant="primary"
                      disabled={busy || selected.agentRequestStatus === "requested"}
                      onClick={() => void requestAgentForTask(selected)}
                    >
                      <Play size={16} aria-hidden />
                      {selected.agentRequestStatus === "requested" ? `${agentName} requested` : `Request ${agentName}`}
                    </Button>
                  ) : selected.executionState === "ready" ? (
                    <Button variant="primary" disabled={busy} onClick={() => void moveTo(selected._id, "in_progress")}>
                      <Play size={16} aria-hidden /> Mark in progress
                    </Button>
                  ) : null}
                  {ABANDONABLE_STATES.has(selected.executionState) ? (
                    abandonConfirming ? (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void abandonTask(selected._id)}
                        style={{ marginLeft: "auto" }}
                      >
                        Confirm?
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setAbandonConfirming(true)}
                        title="Abandon this task. It leaves the board but can be restored later."
                        style={{ marginLeft: "auto" }}
                      >
                        <Ban size={15} aria-hidden /> Abandon task
                      </Button>
                    )
                  ) : null}
                </>
              ) : null
            }
          >
            {selected ? (
              <div style={{ display: "grid", gap: 16 }}>
                {isTaskActive(selected) ? <ActivityBar label={activityLabel(selected)} /> : null}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge tone={executionStateTone(selected.executionState)} dot>
                    {titleCase(selected.executionState)}
                  </Badge>
                  {selected.executionState !== "proposed" &&
                  titleCase(selected.status) !== titleCase(selected.executionState) ? (
                    <Badge tone={taskStatusTone(selected.status)}>Status: {titleCase(selected.status)}</Badge>
                  ) : null}
                  {selected.kind ? <Badge tone="neutral">{selected.kind}</Badge> : null}
                  {selected.agentRequestStatus === "requested" ? (
                    <Badge tone="blue">Queued for {selected.requestedHarness ?? agentName}</Badge>
                  ) : null}
                </div>

                {/* Move between states (kanban) */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span className="muted" style={{ fontWeight: 700 }}>Move to</span>
                  <Select
                    value={selected.executionState}
                    disabled={busy}
                    onChange={(event) => void moveTo(selected._id, event.target.value, selected)}
                    style={{ maxWidth: 200 }}
                  >
                    {EXECUTION_COLUMNS.map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                  </Select>
                </label>

                {selected.description && selected.executionState !== "proposed" ? (
                  <p style={{ margin: 0 }}>{selected.description}</p>
                ) : null}

                {selected.executionState === "proposed" ? (
                  <section>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <h3 style={{ margin: 0 }}>Proposal</h3>
                      {!editingProposal ? (
                        <Button
                          small
                          onClick={() => {
                            setTitleDraft(selected.title ?? "");
                            setProposalDraft(selected.description ?? "");
                            setEditingProposal(true);
                          }}
                        >
                          <Pencil size={14} aria-hidden /> Edit
                        </Button>
                      ) : null}
                    </div>
                    {editingProposal ? (
                      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                        <Field label="Title">
                          <TextInput
                            value={titleDraft}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            placeholder="Task title"
                          />
                        </Field>
                        <Field label="Proposal">
                          <TextArea
                            value={proposalDraft}
                            onChange={(event) => setProposalDraft(event.target.value)}
                            placeholder="Describe the idea, problem, constraints, or proposed solution."
                            style={{ minHeight: 120 }}
                          />
                        </Field>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Button disabled={busy} onClick={() => setEditingProposal(false)}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            disabled={busy || !titleDraft.trim()}
                            onClick={() => void saveProposal(selected._id)}
                          >
                            Save proposal
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className={boardStyles.brief}>{selected.description ?? selected.title}</p>
                        <p className="muted" style={{ fontSize: 14 }}>
                          Create a brief to turn this proposal into an editable, hand-off-ready task.
                        </p>
                      </>
                    )}
                  </section>
                ) : null}

                {/* Execution brief + acceptance criteria (editable pre-execution) */}
                {selected.executionState !== "proposed" ? <section>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <h3 style={{ margin: 0 }}>Execution brief</h3>
                    {PRE_EXECUTION.has(selected.executionState) && !editingBrief ? (
                      <Button small onClick={() => setEditingBrief(true)}>
                        <Pencil size={14} aria-hidden /> Edit
                      </Button>
                    ) : null}
                  </div>
                  {editingBrief ? (
                    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                      <TextArea
                        value={briefDraft}
                        onChange={(event) => setBriefDraft(event.target.value)}
                        placeholder="What to do, where, and any context an executor needs."
                        style={{ minHeight: 120 }}
                      />
                      <Field label="Acceptance criteria (one per line)">
                        <TextArea
                          value={criteriaDraft}
                          onChange={(event) => setCriteriaDraft(event.target.value)}
                          placeholder={"Tests pass\nFeature renders in the app"}
                          style={{ minHeight: 90 }}
                        />
                      </Field>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button disabled={busy} onClick={() => setEditingBrief(false)}>
                          Cancel
                        </Button>
                        <Button variant="primary" disabled={busy} onClick={() => void saveBrief(selected._id)}>
                          Save brief
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {selected.executionBrief ? (
                        <p className={boardStyles.brief}>{selected.executionBrief}</p>
                      ) : (
                        <p className="muted" style={{ fontSize: 14 }}>No brief yet.</p>
                      )}
                      {selected.acceptanceCriteria?.length ? (
                        <>
                          <h3 style={{ marginTop: 14 }}>Acceptance criteria</h3>
                          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                            {selected.acceptanceCriteria.map((criterion: string, index: number) => (
                              <li key={index}>{criterion}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  )}
                </section> : null}

                <TaskAttachments projectId={projectId} taskId={selected._id} />

                {detail?.dependencies?.length ? (
                  <section>
                    <h3>Depends on</h3>
                    <div style={{ display: "grid", gap: 6 }}>
                      {detail.dependencies.map((dep: AnyRecord) => (
                        <div key={dep._id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>{dep.title}</span>
                          <Badge tone={dep.done ? "green" : "gold"}>{dep.done ? "done" : dep.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selected.resultSummary || selected.resultUrl ? (
                  <section>
                    <h3>Result</h3>
                    {selected.resultSummary ? <p style={{ margin: "0 0 6px" }}>{selected.resultSummary}</p> : null}
                    {selected.resultUrl ? (
                      <a className="code" href={selected.resultUrl} target="_blank" rel="noreferrer">
                        {selected.resultUrl}
                      </a>
                    ) : null}
                  </section>
                ) : null}

                {(selected.prUrl || selected.gitBranchName || selected.executionState === "in_review") && project.repoUrl ? (
                  <section>
                    <h3>Pull Request</h3>
                    {selected.prUrl ? (
                      <p style={{ margin: 0 }}>
                        <a className="text-button" href={selected.prUrl} target="_blank" rel="noreferrer">
                          <GitPullRequest size={16} aria-hidden />
                          {selected.prNumber ? `PR #${selected.prNumber}` : "Open pull request"}
                          <ExternalLink size={14} aria-hidden />
                        </a>
                      </p>
                    ) : selected.executionState === "in_review" ? (
                      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                        PR pending or not recorded yet.
                      </p>
                    ) : null}
                    {selected.gitBranchName ? (
                      <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                        Branch: <span className="code">{selected.gitBranchName}</span>
                        {selected.prStatus ? ` · ${selected.prStatus}` : ""}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                {/* Record result only once work is underway (not for briefed/ready). */}
                {RESULT_STATES.has(selected.executionState) ? (
                  <section style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 10 }}>
                    <h3 style={{ margin: 0 }}>Record result (supervise)</h3>
                    <input
                      className="input"
                      placeholder="PR or commit URL (optional)"
                      value={resultUrl}
                      onChange={(event) => setResultUrl(event.target.value)}
                    />
                    <textarea
                      className="textarea"
                      placeholder="What was done? (optional)"
                      value={resultSummary}
                      onChange={(event) => setResultSummary(event.target.value)}
                      style={{ minHeight: 80 }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button disabled={busy} onClick={() => void submitResult(selected._id, false)}>
                        Submit for review
                      </Button>
                      <Button variant="primary" disabled={busy} onClick={() => void submitResult(selected._id, true)}>
                        Mark done
                      </Button>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </Drawer>

          <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Project settings">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Project type">
                <Select value={pKind} onChange={(event) => setPKind(event.target.value)}>
                  <option value="general">General</option>
                  <option value="code">Code (GitHub repo + branch/PR workflow)</option>
                </Select>
              </Field>
              {pKind === "code" ? (
                <Field label="GitHub repo URL">
                  <TextInput value={pRepo} onChange={(event) => setPRepo(event.target.value)} placeholder="https://github.com/you/repo" />
                </Field>
              ) : null}
              {pKind === "code" ? (
                <Field label="Default base branch">
                  <TextInput value={pBaseBranch} onChange={(event) => setPBaseBranch(event.target.value)} placeholder="main" />
                </Field>
              ) : null}
              <Field label="Project local folder">
                <TextInput value={pFolder} onChange={(event) => setPFolder(event.target.value)} placeholder="/Users/you/projects/thing" />
              </Field>
              <FolderOverrideField
                label="Library folder (user files)"
                value={pAssets}
                onChange={setPAssets}
                derivedDefault={pFolderBase ? `${pFolderBase}/_library` : undefined}
                disabled={!pFolderBase}
              />
              <FolderOverrideField
                label="Output folder (artifacts)"
                value={pOutput}
                onChange={setPOutput}
                derivedDefault={pFolderBase ? `${pFolderBase}/_output` : undefined}
                disabled={!pFolderBase}
              />
              <Field label="Summary">
                <TextArea value={pSummary} onChange={(event) => setPSummary(event.target.value)} />
              </Field>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                {project.status === "archived" ? (
                  <Button disabled={busy} onClick={() => void restoreProject()}>
                    <ArchiveRestore size={16} aria-hidden /> Restore project
                  </Button>
                ) : (
                  <Button variant="danger" disabled={busy} onClick={() => void archiveProject()}>
                    <Archive size={16} aria-hidden /> Archive project
                  </Button>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
                  <Button variant="primary" disabled={busy} onClick={() => void saveSettings()}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </Dialog>
          <Dialog open={proposalOpen} onClose={() => setProposalOpen(false)} title="New task proposal">
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Kind">
                <Select value={proposalKind} onChange={(event) => setProposalKind(event.target.value)}>
                  <option value="coding">Coding</option>
                  <option value="review">Review</option>
                  <option value="design">Design</option>
                  <option value="research">Research</option>
                  <option value="planning">Planning</option>
                  <option value="manual">Manual</option>
                </Select>
              </Field>
              <Field label="Proposal">
                <TextArea
                  value={proposalText}
                  onChange={(event) => setProposalText(event.target.value)}
                  placeholder="Describe the idea, problem, constraints, or proposed solution."
                  style={{ minHeight: 140 }}
                />
              </Field>
              <Field label="Attachments (optional)">
                <div style={{ display: "grid", gap: 6 }}>
                  {proposalFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                    >
                      <Folder size={13} aria-hidden style={{ flexShrink: 0, opacity: 0.6 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </span>
                      <span className="muted" style={{ flexShrink: 0 }}>
                        {formatFileSize(file.size)}
                      </span>
                      <button
                        type="button"
                        className="text-button compact"
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                        onClick={() => setProposalFiles((current) => current.filter((_, i) => i !== index))}
                        disabled={proposalBusy}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <label className="text-button compact" style={{ cursor: "pointer", width: "fit-content" }}>
                    <Plus size={14} aria-hidden /> Add files
                    <input
                      type="file"
                      multiple
                      accept={PROJECT_FILE_ACCEPT}
                      style={{ display: "none" }}
                      disabled={proposalBusy}
                      onChange={(event) => {
                        const picked = Array.from(event.target.files ?? []);
                        event.target.value = "";
                        const accepted: File[] = [];
                        for (const file of picked) {
                          const check = checkProjectFile({
                            fileName: file.name,
                            mimeType: file.type,
                            sizeBytes: file.size,
                          });
                          if (check.ok) accepted.push(file);
                          else toast(`${file.name}: ${check.reason}`, "error");
                        }
                        if (accepted.length) setProposalFiles((current) => [...current, ...accepted]);
                      }}
                    />
                  </label>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    Files upload to the project Library, attached to the new task.
                  </p>
                </div>
              </Field>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button onClick={() => setProposalOpen(false)} disabled={proposalBusy}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={proposalBusy || !proposalText.trim()}
                  onClick={() => void proposeTask()}
                >
                  <Plus size={16} aria-hidden /> {proposalBusy ? "Proposing…" : "Propose Task"}
                </Button>
              </div>
            </div>
          </Dialog>
        </>
      )}
    </LiveGate>
  );
}
