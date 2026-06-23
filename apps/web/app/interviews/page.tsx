import Link from "next/link";
import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell, PageHeader, icons } from "../ui";
import { LiveInterviewsIndex } from "./ui";

const sampleTemplates = [
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
    kind: "weekly_review",
    title: "Weekly review",
    description: "Reflect on wins, open loops, learning, and the shape of next week.",
    questionCount: 4,
  },
];

const sampleRecent = [
  {
    id: "weekly-static",
    title: "Weekly review",
    status: "active",
    detail: "2 of 4 questions answered",
  },
  {
    id: "decision-static",
    title: "Decision check-in: reminder sync",
    status: "completed",
    detail: "Completed static preview",
  },
];

export default function InterviewsPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Interviews" title="Guided check-ins for useful memory." />
      {isLiveConfigured() ? <LiveInterviewsIndex /> : <StaticInterviewsIndex />}
    </AppShell>
  );
}

function StaticInterviewsIndex() {
  return (
    <div className="grid">
      <section className="card section span-5">
        <h2>Start interview</h2>
        <p className="muted">Static preview. Live mode can start project, goal, person, decision, and weekly review interviews.</p>
        <div className="item-list">
          {sampleTemplates.map((template) => (
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
      <section className="card section span-7">
        <h2>Active and recent</h2>
        <div className="item-list">
          {sampleRecent.map((interview) => (
            <Link className="item project-row" href={`/interviews/${interview.id}`} key={interview.id}>
              <span className={interview.status === "active" ? "item-icon is-active" : "item-icon"}>
                <icons.MessageSquareText size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{interview.title}</p>
                <p className="item-meta">{interview.detail}</p>
              </div>
              <span className={interview.status === "active" ? "badge gold" : "badge blue"}>{interview.status}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
