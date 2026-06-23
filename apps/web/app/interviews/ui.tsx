"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../lib/skippy-api";
import { LiveGate } from "../live-auth";
import { icons } from "../ui";

type AnyRecord = Record<string, any>;
type InterviewKind = "project" | "goal" | "person" | "decision" | "weekly_review";

const fallbackTemplates = [
  {
    kind: "project",
    title: "Project check-in",
    description: "Clarify scope, momentum, blockers, and next action.",
    questionCount: 4,
  },
  {
    kind: "goal",
    title: "Goal check-in",
    description: "Reconnect a goal to motivation, evidence, constraints, and next move.",
    questionCount: 4,
  },
  {
    kind: "person",
    title: "Person check-in",
    description: "Capture relationship context and useful follow-up memory.",
    questionCount: 4,
  },
  {
    kind: "decision",
    title: "Decision check-in",
    description: "Make a decision legible: options, criteria, choice, and revisit trigger.",
    questionCount: 4,
  },
  {
    kind: "weekly_review",
    title: "Weekly review",
    description: "Reflect on wins, open loops, learning, and the shape of next week.",
    questionCount: 4,
  },
] as const;

function useViewerReady() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.auth.viewer, isAuthenticated ? {} : "skip") as
    | { brain?: AnyRecord | null }
    | null
    | undefined;

  return Boolean(viewer?.brain);
}

function formatKind(kind: string) {
  return kind.replace("_", " ");
}

function progressText(interview: AnyRecord, total: number) {
  if (interview.status === "active") {
    return `${Math.min(interview.currentQuestionIndex ?? 0, total)} of ${total} questions answered`;
  }
  if (interview.completedAt) {
    return "Completed";
  }
  if (interview.archivedAt) {
    return "Archived";
  }
  return `${total} questions`;
}

export function LiveInterviewsIndex() {
  const router = useRouter();
  const viewerReady = useViewerReady();
  const data = useQuery(api.interviews.listForViewer, viewerReady ? { recentLimit: 16 } : "skip") as
    | { templates: AnyRecord[]; active: AnyRecord[]; recent: AnyRecord[] }
    | undefined;
  const startInterview = useMutation(api.interviews.start);
  const [kind, setKind] = useState<InterviewKind>("weekly_review");
  const [title, setTitle] = useState("");
  const [subjectLabel, setSubjectLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const templates = data?.templates?.length ? data.templates : fallbackTemplates;
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...(data?.active ?? []), ...(data?.recent ?? [])].filter((interview) => {
      if (seen.has(interview._id)) {
        return false;
      }
      seen.add(interview._id);
      return true;
    });
  }, [data]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const trimmedTitle = title.trim();
      const trimmedSubjectLabel = subjectLabel.trim();
      const result = await startInterview({
        kind,
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        ...(trimmedSubjectLabel ? { subjectLabel: trimmedSubjectLabel } : {}),
      });
      router.push(`/interviews/${encodeURIComponent(String(result.interviewId))}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start interview.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LiveGate>
      {!viewerReady || !data ? (
        <section className="card section">
          <h2>Loading interviews</h2>
          <p className="muted">Checking active and recent guided check-ins.</p>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-5">
            <h2>Start interview</h2>
            <form className="item-list" onSubmit={handleSubmit}>
              <label>
                <span className="eyebrow">Template</span>
                <select className="select" value={kind} onChange={(event) => setKind(event.target.value as InterviewKind)}>
                  {templates.map((template) => (
                    <option value={template.kind} key={template.kind}>
                      {template.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="eyebrow">Title</span>
                <input
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Optional custom title"
                />
              </label>
              <label>
                <span className="eyebrow">Subject</span>
                <input
                  className="input"
                  value={subjectLabel}
                  onChange={(event) => setSubjectLabel(event.target.value)}
                  placeholder="Optional project, goal, person, or decision label"
                />
              </label>
              {error ? <p className="item-meta">{error}</p> : null}
              <button className="text-button" type="submit" disabled={submitting}>
                {submitting ? "Starting" : "Start"}
              </button>
            </form>
          </section>

          <section className="card section span-7">
            <h2>Templates</h2>
            <div className="item-list">
              {templates.map((template) => (
                <article className="item" key={template.kind}>
                  <span className="item-icon">
                    <icons.MessageSquareText size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">{template.title}</p>
                    <p className="item-meta">{template.description}</p>
                  </div>
                  <span className="badge blue">{template.questionCount} q</span>
                </article>
              ))}
            </div>
          </section>

          <section className="card section span-12">
            <h2>Active and recent</h2>
            {recent.length === 0 ? (
              <p className="muted">No interviews yet.</p>
            ) : (
              <div className="item-list">
                {recent.map((interview) => (
                  <Link className="item project-row" href={`/interviews/${interview._id}`} key={interview._id}>
                    <span className={interview.status === "active" ? "item-icon is-active" : "item-icon"}>
                      <icons.MessageSquareText size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{interview.title}</p>
                      <p className="item-meta">
                        {formatKind(interview.templateKind)} · {progressText(interview, interview.questionCount)}
                      </p>
                    </div>
                    <span className={interview.status === "active" ? "badge gold" : "badge blue"}>{interview.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </LiveGate>
  );
}

export function LiveInterviewDetail({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const viewerReady = useViewerReady();
  const data = useQuery(api.interviews.detailForViewer, viewerReady ? { interviewId: interviewId as any } : "skip") as
    | {
        interview: AnyRecord;
        template: AnyRecord;
        responses: AnyRecord[];
        currentQuestion?: AnyRecord;
        progress: { answered: number; total: number };
      }
    | null
    | undefined;
  const answerQuestion = useMutation(api.interviews.answerCurrentQuestion);
  const completeInterview = useMutation(api.interviews.complete);
  const archiveInterview = useMutation(api.interviews.archive);
  const [answerText, setAnswerText] = useState("");
  const [summary, setSummary] = useState("");
  const [createMemoryCandidate, setCreateMemoryCandidate] = useState(false);
  const [createSummaryMemoryCandidate, setCreateSummaryMemoryCandidate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const result = await answerQuestion({
        interviewId: interviewId as any,
        answerText,
        createMemoryCandidate,
      });
      setAnswerText("");
      setCreateMemoryCandidate(false);
      setNotice(result.memoryCandidateId ? "Answer saved and sent to memory review." : "Answer saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save answer.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete() {
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const trimmedSummary = summary.trim();
      const result = await completeInterview({
        interviewId: interviewId as any,
        ...(trimmedSummary ? { summary: trimmedSummary } : {}),
        createSummaryMemoryCandidate,
      });
      setNotice(result.memoryCandidateId ? "Interview completed and sent to memory review." : "Interview completed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete interview.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive() {
    setSubmitting(true);
    setError(null);

    try {
      await archiveInterview({ interviewId: interviewId as any });
      router.push("/interviews");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive interview.");
      setSubmitting(false);
    }
  }

  return (
    <LiveGate>
      {!viewerReady || data === undefined ? (
        <section className="card section">
          <h2>Loading interview</h2>
          <p className="muted">Fetching questions and responses.</p>
        </section>
      ) : !data ? (
        <section className="card section">
          <h2>Interview not found</h2>
          <p className="muted">This interview may have been archived or removed.</p>
        </section>
      ) : (
        <div className="grid">
          <section className="card section span-7">
            <div className="settings-row">
              <div>
                <h2>{data.interview.title}</h2>
                <p className="muted">
                  {data.template.title} · {data.progress.answered} of {data.progress.total} answered
                </p>
              </div>
              <span className={data.interview.status === "active" ? "badge gold" : "badge blue"}>{data.interview.status}</span>
            </div>

            {data.currentQuestion ? (
              <form className="item-list" onSubmit={handleAnswer}>
                <article className="item">
                  <span className="item-icon is-active">
                    <icons.MessageSquareText size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">{data.currentQuestion.prompt}</p>
                    {data.currentQuestion.helper || data.currentQuestion.placeholder ? (
                      <p className="item-meta">{data.currentQuestion.helper ?? data.currentQuestion.placeholder}</p>
                    ) : null}
                  </div>
                  <span className="badge">current</span>
                </article>
                <textarea
                  className="textarea"
                  value={answerText}
                  onChange={(event) => setAnswerText(event.target.value)}
                  placeholder={data.currentQuestion.placeholder ?? "Write the answer Skippy should remember as context."}
                />
                {data.currentQuestion.captureMemoryAs ? (
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={createMemoryCandidate}
                      onChange={(event) => setCreateMemoryCandidate(event.target.checked)}
                    />
                    Send this answer to memory review
                  </label>
                ) : null}
                <div className="toolbar">
                  <button className="text-button" type="submit" disabled={submitting || !answerText.trim()}>
                    Save answer
                  </button>
                  <button className="text-button" type="button" disabled={submitting} onClick={handleComplete}>
                    Complete now
                  </button>
                  <button className="text-button" type="button" disabled={submitting} onClick={handleArchive}>
                    Archive
                  </button>
                </div>
              </form>
            ) : (
              <div className="item-list">
                <article className="item">
                  <span className="item-icon">
                    <icons.CircleCheck size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">All questions answered</p>
                    <p className="item-meta">Complete the interview, optionally sending a summary to memory review.</p>
                  </div>
                  <span className="badge blue">ready</span>
                </article>
                {data.interview.status === "active" ? (
                  <>
                    <textarea
                      className="textarea"
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      placeholder="Optional short summary"
                    />
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={createSummaryMemoryCandidate}
                        onChange={(event) => setCreateSummaryMemoryCandidate(event.target.checked)}
                      />
                      Send interview summary to memory review
                    </label>
                    <div className="toolbar">
                      <button className="text-button" type="button" disabled={submitting} onClick={handleComplete}>
                        Complete
                      </button>
                      <button className="text-button" type="button" disabled={submitting} onClick={handleArchive}>
                        Archive
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
            {notice ? <p className="item-meta">{notice}</p> : null}
            {error ? <p className="item-meta">{error}</p> : null}
          </section>

          <section className="card section span-5">
            <h2>Responses</h2>
            {data.responses.length === 0 ? (
              <p className="muted">No answers saved yet.</p>
            ) : (
              <div className="item-list">
                {data.responses.map((response) => (
                  <article className="item" key={response._id}>
                    <span className="item-icon">
                      <icons.Check size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{response.prompt}</p>
                      <p className="item-meta">{response.answerText}</p>
                      {response.memoryCandidateId ? <span className="badge blue">memory review</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </LiveGate>
  );
}
