"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  ClipboardCopy,
  ExternalLink,
  Folder,
  GitBranch,
  GitPullRequest,
  Pencil,
  Plus,
  Play,
  Settings2,
  Sparkles,
} from "lucide-react";
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
  TextArea,
  TextInput,
  useToast,
} from "../components";
import { EXECUTION_COLUMNS, executionStateTone, taskStatusTone, titleCase } from "../../lib/display";
import { useViewerReady } from "./use-viewer";
import boardStyles from "./board.module.css";

type AnyRecord = Record<string, any>;

// States where the task hasn't been executed yet — brief is editable, no result capture.
const PRE_EXECUTION = new Set(["unplanned", "briefed", "ready", "blocked"]);
// States where recording a result makes sense.
const RESULT_STATES = new Set(["in_progress", "in_review"]);

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
  const recordResult = useMutation(api.projects.recordTaskResultForViewer);
  const requestAgent = useMutation(api.projects.requestAgentForTaskForViewer);
  const setExecState = useMutation(api.projects.setTaskExecutionStateForViewer);
  const updateBrief = useMutation(api.projects.updateTaskBriefForViewer);
  const updateProject = useMutation(api.projects.updateProjectForViewer);
  const setViewerContext = useMutation(api.projects.setViewerContext);
  const toast = useToast();

  const [planning, setPlanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefingTaskIds, setBriefingTaskIds] = useState<Set<string>>(new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverState, setDragOverState] = useState<string | null>(null);

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

  // Project settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pKind, setPKind] = useState("general");
  const [pRepo, setPRepo] = useState("");
  const [pBaseBranch, setPBaseBranch] = useState("");
  const [pFolder, setPFolder] = useState("");
  const [pSummary, setPSummary] = useState("");

  const selected = board?.tasks?.find((task: AnyRecord) => task._id === selectedId) ?? null;
  const detail = useQuery(
    api.projects.getTaskBriefForViewer,
    viewerReady && selectedId ? { taskId: selectedId as any } : "skip",
  ) as AnyRecord | null | undefined;

  // Tell the harness which project is open ("this project").
  useEffect(() => {
    if (!viewerReady) return;
    void setViewerContext({ activeRoute: `/projects/${projectId}`, activeProjectId: projectId as any }).catch(
      () => undefined,
    );
  }, [viewerReady, projectId, setViewerContext]);

  // Reset edit state whenever a different task is opened.
  useEffect(() => {
    setEditingBrief(false);
    setEditingProposal(false);
    if (selected) {
      setBriefDraft(selected.executionBrief ?? "");
      setCriteriaDraft((selected.acceptanceCriteria ?? []).join("\n"));
      setTitleDraft(selected.title ?? "");
      setProposalDraft(selected.description ?? "");
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = board?.project;
  const agentName = board?.agentName ?? "Agent";
  const ownerName = board?.ownerName ?? "Owner";
  const openSettings = () => {
    if (!project) return;
    setPKind(project.kind ?? "general");
    setPRepo(project.repoUrl ?? "");
    setPBaseBranch(project.defaultBaseBranch ?? "");
    setPFolder(project.localPath ?? "");
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
      await createTaskProposal({
        projectId: projectId as any,
        proposalText: text,
        kind: proposalKind as any,
      });
      setProposalOpen(false);
      setProposalText("");
      setProposalKind("coding");
      toast("Task proposed.", "success");
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

  const dropTaskInState = async (state: string) => {
    if (!draggedTaskId) return;
    const task = board?.tasks?.find((candidate: AnyRecord) => candidate._id === draggedTaskId);
    setDraggedTaskId(null);
    setDragOverState(null);
    if (!task || task.executionState === state) return;
    await moveTo(draggedTaskId, state, task);
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
    setBusy(true);
    try {
      await updateProject({
        projectId: projectId as any,
        kind: pKind as any,
        repoUrl: pRepo,
        defaultBaseBranch: pBaseBranch,
        localPath: pFolder,
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
                <Button variant="primary" onClick={() => void runPlan()} disabled={planning}>
                  <Sparkles size={17} aria-hidden />
                  {planning ? "Planning…" : board.tasks.length ? "Re-plan with AI" : "Plan with AI"}
                </Button>
              </div>
            </div>
          </div>

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
                    className={`${boardStyles.column} ${dragOverState === column.key ? boardStyles.columnDropTarget : ""}`}
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
                      {tasks.map((task: AnyRecord) => (
                        <button
                          key={task._id}
                          className={`${boardStyles.taskCard} ${task.ownerType === "owner" ? boardStyles.ownerTaskCard : ""} ${draggedTaskId === task._id ? boardStyles.taskCardDragging : ""}`}
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
                            {task.kind ? <Badge tone="neutral">{task.kind}</Badge> : null}
                            {task.agentRequestStatus === "requested" ? (
                              <Badge tone="blue">Queued for {task.requestedHarness ?? agentName}</Badge>
                            ) : null}
                            {task.dependsOn?.length ? <Badge tone="gold">{task.dependsOn.length} dep</Badge> : null}
                            {task.resultUrl ? <Badge tone="green">result</Badge> : null}
                          </span>
                          {isTaskActive(task) ? <ActivityBar label={activityLabel(task)} /> : null}
                        </button>
                      ))}
                      {tasks.length === 0 ? <p className={boardStyles.columnEmpty}>—</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
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
              <Field label="Local folder path (output files / assets)">
                <TextInput value={pFolder} onChange={(event) => setPFolder(event.target.value)} placeholder="/Users/you/projects/thing" />
              </Field>
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
