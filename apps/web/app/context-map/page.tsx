import Link from "next/link";
import { isLiveConfigured } from "../../lib/skippy-api";
import { AppShell, PageHeader, icons } from "../ui";
import { companies, people, projects } from "../sample-data";
import { LiveContextMapContent } from "./context-map-content";

const sampleQuestions = [
  {
    id: "question-link-enrichment",
    title: "When should link enrichment run automatically?",
    summary: "Open policy question for balancing useful summaries against noise and cost.",
    sources: ["settings review"],
  },
  {
    id: "question-reminder-sync",
    title: "Which reminder writes require approval?",
    summary: "Completion and outbound source changes should stay explicit until the risk policy is tuned.",
    sources: ["pending action policy"],
  },
];

export default function ContextMapPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="Context map" title="Readable maps for second-brain context." />
      {isLiveConfigured() ? <LiveContextMapContent /> : <StaticContextMapContent />}
    </AppShell>
  );
}

function StaticContextMapContent() {
  return (
    <div className="grid">
      <section className="card section span-12">
        <h2>Static preview</h2>
        <p className="muted">Live Convex data will group accepted projects, contacts, questions, memories, and source refs here.</p>
      </section>

      <section className="span-12">
        <div className="settings-row">
          <div>
            <h2>Projects</h2>
            <p className="muted">Project to tasks, memories, and source refs.</p>
          </div>
          <span className="badge">{projects.length}</span>
        </div>
      </section>
      {projects.map((project) => (
        <section className="card section span-12" key={project.title}>
          <div className="settings-row">
            <div>
              <h2>{project.title}</h2>
              <p className="muted">{project.summary}</p>
            </div>
            <Link className="text-button compact" href={`/projects/${encodeURIComponent(project.title)}`}>
              Open
            </Link>
          </div>
          <div className="grid">
            <section className="span-6">
              <h3>Tasks</h3>
              <div className="item-list">
                {project.tasks.map((task) => (
                  <article className="item" key={task}>
                    <span className="item-icon">
                      <icons.Check size={17} aria-hidden />
                    </span>
                    <div>
                      <p className="item-title">{task}</p>
                      <p className="item-meta">Accepted task link.</p>
                    </div>
                    <span className="badge blue">task</span>
                  </article>
                ))}
              </div>
            </section>
            <section className="span-6">
              <h3>Memories</h3>
              <div className="item-list">
                <Link className="item project-row" href="/library/principle-short-tasks">
                  <span className="item-icon">
                    <icons.BookOpen size={17} aria-hidden />
                  </span>
                  <div>
                    <p className="item-title">Short task titles</p>
                    <p className="item-meta">Principle linked through project work.</p>
                  </div>
                  <span className="badge blue">principle</span>
                </Link>
              </div>
            </section>
          </div>
        </section>
      ))}

      <section className="span-12">
        <div className="settings-row">
          <div>
            <h2>People and companies</h2>
            <p className="muted">Contacts to related memories and source refs.</p>
          </div>
          <span className="badge">{people.length + companies.length}</span>
        </div>
      </section>
      {[...people, ...companies].map((contact) => (
        <section className="card section span-6" key={contact.name}>
          <div className="settings-row">
            <div>
              <h2>{contact.name}</h2>
              <p className="muted">{contact.context}</p>
            </div>
            <Link className="text-button compact" href="/contacts">
              Open
            </Link>
          </div>
          <div className="item-list">
            <article className="item">
              <span className="item-icon">
                <icons.LinkIcon size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">{contact.badge} source context</p>
                <p className="item-meta">Static preview source reference.</p>
              </div>
              <span className="badge">source</span>
            </article>
          </div>
        </section>
      ))}

      <section className="span-12">
        <div className="settings-row">
          <div>
            <h2>Questions</h2>
            <p className="muted">Questions to nearby memories and source refs.</p>
          </div>
          <span className="badge">{sampleQuestions.length}</span>
        </div>
      </section>
      {sampleQuestions.map((question) => (
        <section className="card section span-6" key={question.id}>
          <div className="settings-row">
            <div>
              <h2>{question.title}</h2>
              <p className="muted">{question.summary}</p>
            </div>
            <Link className="text-button compact" href={`/library/${question.id}`}>
              Open
            </Link>
          </div>
          <div className="toolbar">
            {question.sources.map((source) => (
              <span className="badge" key={source}>
                {source}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
