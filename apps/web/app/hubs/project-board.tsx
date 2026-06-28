"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, ClipboardCopy, Play, Sparkles } from "lucide-react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  LoadingRow,
  ProgressBar,
  useToast,
} from "../components";
import { EXECUTION_COLUMNS, executionStateTone, taskStatusTone, titleCase } from "../../lib/display";
import { useViewerReady } from "./use-viewer";
import boardStyles from "./board.module.css";

type AnyRecord = Record<string, any>;

function buildBriefText(task: AnyRecord, projectTitle?: string): string {
  const lines = [`# ${task.title}`];
  if (projectTitle) lines.push(`Project: ${projectTitle}`);
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
  const markInProgress = useMutation(api.knowledge.markTaskInProgressForViewer);
  const markDone = useMutation(api.knowledge.markTaskDoneForViewer);
  const recordResult = useMutation(api.projects.recordTaskResultForViewer);
  const toast = useToast();

  const [planning, setPlanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = board?.tasks?.find((task: AnyRecord) => task._id === selectedId) ?? null;
  const detail = useQuery(
    api.projects.getTaskBriefForViewer,
    viewerReady && selectedId ? { taskId: selectedId as any } : "skip",
  ) as AnyRecord | null | undefined;

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
      await navigator.clipboard.writeText(buildBriefText(task, board?.project?.title));
      toast("Brief copied — paste it into your coding agent.", "success");
    } catch {
      toast("Could not copy to clipboard", "error");
    }
  };

  const startTask = async (taskId: string) => {
    setBusy(true);
    try {
      await markInProgress({ taskId: taskId as any });
      toast("Task moved to in progress.", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start task", "error");
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <p className="eyebrow">Project</p>
                <h1>{board.project.title}</h1>
                {board.project.summary ? <p className="muted" style={{ maxWidth: 640 }}>{board.project.summary}</p> : null}
              </div>
              <Button variant="primary" onClick={() => void runPlan()} disabled={planning}>
                <Sparkles size={17} aria-hidden />
                {planning ? "Planning…" : board.tasks.length ? "Re-plan with AI" : "Plan with AI"}
              </Button>
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
                  <div key={column.key} className={boardStyles.column}>
                    <div className={boardStyles.columnHead}>
                      <span>{column.label}</span>
                      <span className={boardStyles.columnCount}>{tasks.length}</span>
                    </div>
                    <div className={boardStyles.columnBody}>
                      {tasks.map((task: AnyRecord) => (
                        <button key={task._id} className={boardStyles.taskCard} onClick={() => setSelectedId(task._id)} type="button">
                          <span className={boardStyles.taskTitle}>{task.title}</span>
                          <span className={boardStyles.taskMeta}>
                            {task.kind ? <Badge tone="neutral">{task.kind}</Badge> : null}
                            {task.dependsOn?.length ? <Badge tone="gold">{task.dependsOn.length} dep</Badge> : null}
                            {task.resultUrl ? <Badge tone="green">result</Badge> : null}
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

          <Drawer
            open={Boolean(selectedId)}
            onClose={() => setSelectedId(null)}
            eyebrow={selected ? titleCase(selected.executionState) : "Task"}
            title={selected?.title ?? "Task"}
            footer={
              selected ? (
                <>
                  <Button onClick={() => void copyBrief(selected)}>
                    <ClipboardCopy size={16} aria-hidden /> Copy brief
                  </Button>
                  {selected.executionState === "ready" || selected.executionState === "briefed" ? (
                    <Button variant="primary" disabled={busy} onClick={() => void startTask(selected._id)}>
                      <Play size={16} aria-hidden /> Start
                    </Button>
                  ) : null}
                </>
              ) : null
            }
          >
            {selected ? (
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={executionStateTone(selected.executionState)} dot>
                    {titleCase(selected.executionState)}
                  </Badge>
                  {titleCase(selected.status) !== titleCase(selected.executionState) ? (
                    <Badge tone={taskStatusTone(selected.status)}>Status: {titleCase(selected.status)}</Badge>
                  ) : null}
                  {selected.kind ? <Badge tone="neutral">{selected.kind}</Badge> : null}
                </div>

                {selected.description ? <p style={{ margin: 0 }}>{selected.description}</p> : null}

                {selected.executionBrief ? (
                  <section>
                    <h3>Execution brief</h3>
                    <p className={boardStyles.brief}>{selected.executionBrief}</p>
                  </section>
                ) : null}

                {selected.acceptanceCriteria?.length ? (
                  <section>
                    <h3>Acceptance criteria</h3>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                      {selected.acceptanceCriteria.map((criterion: string, index: number) => (
                        <li key={index}>{criterion}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

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

                {selected.executionState !== "done" ? (
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
        </>
      )}
    </LiveGate>
  );
}
