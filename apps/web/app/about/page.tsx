import { AppShell, PageHeader, icons } from "../ui";

const mcpCapabilities = [
  {
    title: "Create accepted projects and tasks",
    detail:
      "When the user is explicit, a connected harness can add work directly to the Skippy board and mark tasks in progress or done.",
    badge: "Direct",
  },
  {
    title: "Submit knowledge for review",
    detail:
      "Email, calendar, messages, links, notes, people, companies, goals, projects, and tasks can be submitted as triage candidates with source references.",
    badge: "Triage",
  },
  {
    title: "Link and merge entities",
    detail:
      "Accepted objects can be connected with relationships, reviewed later, and merged when new context matches something already stored.",
    badge: "Graph",
  },
  {
    title: "Generate focus and retrieval context",
    detail:
      "Internal AI can summarize current focus, rank relevant entities, and use embeddings to retrieve related Skippy knowledge.",
    badge: "AI",
  },
  {
    title: "Track pending external actions",
    detail:
      "Side effects such as reminder completion or future outbound actions are separated from knowledge and surfaced for review.",
    badge: "Review",
  },
  {
    title: "Dispatch urgent notifications",
    detail:
      "When push notifications are configured, Skippy can notify subscribed browsers about urgent tasks and pending actions.",
    badge: "Notify",
  },
];

const connectionSteps = [
  {
    title: "Open a harness with MCP support",
    detail:
      "Use Codex, ChatGPT, Claude Desktop, or another client that can connect to remote Model Context Protocol servers.",
  },
  {
    title: "Add the Skippy MCP endpoint",
    detail: "Use https://skippy.jeffschram.dev/api/mcp for the deployed server.",
  },
  {
    title: "Authenticate with a Skippy token",
    detail:
      "Create or copy a token from Settings, then provide it as the bearer token or authorization credential required by the harness.",
  },
  {
    title: "Ask the harness to use Skippy",
    detail:
      "The harness discovers Skippy tools automatically, then chooses direct create, triage, review, retrieval, or notification tools based on your request.",
  },
];

export default function AboutPage() {
  return (
    <AppShell>
      <PageHeader eyebrow="About" title="Skippy is an MCP server and a review app for your personal operating context." />

      <div className="grid">
        <section className="card section span-7">
          <h2>What Skippy is</h2>
          <p className="muted">
            Skippy gives AI harnesses a shared place to store useful personal context without turning every
            inference into permanent knowledge. The MCP server is the interface harnesses connect to. The web app
            is where you review, correct, configure, and monitor what Skippy knows.
          </p>
          <div className="item-list">
            <article className="item">
              <span className="item-icon">
                <icons.MessageSquareText size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">MCP server</p>
                <p className="item-meta">
                  Exposes tools that let connected AI clients create tasks, submit candidates, fetch context,
                  generate summaries, and report action results.
                </p>
              </div>
              <span className="badge blue">Tools</span>
            </article>
            <article className="item">
              <span className="item-icon">
                <icons.Archive size={17} aria-hidden />
              </span>
              <div>
                <p className="item-title">Web app</p>
                <p className="item-meta">
                  Shows accepted projects, active tasks, contacts, triage suggestions, pending actions, settings,
                  tokens, notification preferences, and live Convex data.
                </p>
              </div>
              <span className="badge">Review</span>
            </article>
          </div>
        </section>

        <section className="card section span-5">
          <h2>Connect</h2>
          <div className="item-list">
            {connectionSteps.map((step, index) => (
              <article className="item" key={step.title}>
                <span className="item-icon">
                  <icons.CircleCheck size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">
                    {index + 1}. {step.title}
                  </p>
                  <p className="item-meta">{step.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="span-12">
          <h2>MCP capabilities</h2>
          <div className="item-list about-capabilities">
            {mcpCapabilities.map((capability) => (
              <article className="item" key={capability.title}>
                <span className="item-icon">
                  <icons.Check size={17} aria-hidden />
                </span>
                <div>
                  <p className="item-title">{capability.title}</p>
                  <p className="item-meta">{capability.detail}</p>
                </div>
                <span className="badge gold">{capability.badge}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="card section span-12">
          <h2>How the pieces work together</h2>
          <p className="muted">
            A harness reads the MCP tool descriptions, decides when Skippy is relevant, and calls the appropriate
            tool. Explicit instructions can become accepted projects or tasks immediately. Inferred information from
            Gmail, Calendar, messages, links, or other sources should usually enter triage first. Convex stores the
            data, Clerk protects the app, and this web UI gives you the final say over what becomes durable context.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
