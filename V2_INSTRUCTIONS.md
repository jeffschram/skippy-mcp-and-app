# Using Skippy (v2)

Skippy is your **second brain** and a **supervised project dashboard**. It is two things at once:

- A **web app** where you review what Skippy knows and run your projects.
- An **MCP server** that connected assistants (like Claude) use to capture knowledge and execute work on your behalf.

The guiding principle for projects: **Skippy plans, a coding agent executes, you supervise.** Skippy breaks a project into ready-to-run task briefs; a coding agent does the work and reports back; you approve.

---

## 1. First-time setup

1. **Sign in** — the app uses Clerk. Click *Sign in* in the sidebar (or the top bar on mobile). Your brain is created automatically on first sign-in.
2. **(Optional but recommended) Turn on an AI provider** — open **Settings → Settings** and choose an LLM provider (OpenAI, Anthropic, etc.). This powers automated project planning and focus summaries. Without it, those features show a "configure a provider" message but everything else works.
   - The provider's API key must also be set as an environment variable on the Convex deployment (e.g. `OPENAI_API_KEY`). If you're not sure, that's a deployment/admin step.
3. **(Optional) Connect an assistant** — see *Connecting an assistant (MCP)* below to let Claude or another harness capture knowledge and run tasks.

---

## 2. The five hubs

The sidebar has five places. That's the whole app.

| Hub | What it's for |
| --- | --- |
| **Today** | Your landing page: what to focus on now, what's ready to work on, what needs review, and your active projects. |
| **Projects** | Create projects and run them as a plan board. The heart of project automation. |
| **Brain** | Everything Skippy knows — Library, Inbox, Contacts, Goals, Interviews, and the relationship Map (tabs). |
| **Review** | One queue for decisions — unclear signals, external actions awaiting approval, and recall routines (tabs). |
| **Settings** | Brain configuration, MCP tokens, activity logs, and an About page (tabs). |

---

## 3. Running a project (the plan → execute loop)

This is the main new capability in v2.

1. **Create a project** — go to **Projects → New project**, give it a title and an optional summary.
2. **Plan it** — open the project and click **Plan with AI**. Skippy decomposes it into an ordered set of tasks, each with:
   - an **execution brief** (a self-contained description you can hand to a coding agent),
   - **acceptance criteria**, and
   - **dependencies** (which tasks must finish first).
   - *(Requires an LLM provider — see setup step 2.)*
3. **Read the board** — tasks are organized into columns by execution state: **Briefed → Ready → In progress → In review → Blocked → Done**. Only tasks whose dependencies are all complete sit in **Ready**.
4. **Hand a task to a coding agent** — click a task to open its drawer, then **Copy brief**. Paste it into Claude Code (or any coding agent) and let it do the work.
5. **Supervise the result** — when the work is done, record the outcome (a summary and/or a PR/commit URL). By default the task moves to **In review** so you can approve it; or mark it **Done** directly.
6. **Watch it flow** — completing a task automatically unblocks any tasks that depended on it, moving them to **Ready**.

> You can re-plan a project at any time (**Re-plan with AI**) to add a fresh set of tasks — for example after the scope changes.

**Today → Ready to work** shows the next unblocked tasks across all your projects, so you always know what to pick up next.

---

## 4. Capturing and reviewing knowledge

Most knowledge arrives through a connected assistant (see MCP below), but here's how to work with it:

- **Brain → Inbox** — memories captured for review. Accept, edit, or reject them.
- **Brain → Library** — your accepted knowledge (decisions, principles, questions, notes), filterable by type.
- **Brain → Contacts / Goals / Interviews / Map** — people & companies, your active goals (which shape what Skippy considers important), guided check-in interviews, and the relationship graph.
- **Review → Signals** — items Skippy was unsure about; give them a decision (accept, correct, merge, reject).
- **Review → Actions** — external side effects (like sending an email) that an assistant drafted. **Nothing leaves Skippy without your approval here.**
- **Review → Routines** — recall suggestions: stale assumptions, open questions, follow-ups, context gaps.

**Today** surfaces a focus summary ("Now") with a one-line headline summarizing the bullets; you can dismiss a bullet, turn it into a task, or mark it already done.

---

## 5. Connecting an assistant (MCP)

Skippy exposes an MCP server so assistants can capture knowledge and run the plan→execute loop.

1. In **Settings → Settings**, create an **MCP token**. Copy it (it's shown only once).
2. Point your harness at the MCP endpoint — `/<your-skippy-url>/api/mcp` — using that token as a bearer token.
3. The assistant now has tools to capture notes, ingest source-backed items, run interviews, plan projects, fetch task briefs, and report results.

The harness behavior is documented in `skills/skippy-harness/SKILL.md`.

---

## 6. Slash commands

When chatting with a connected assistant, you can type shorthand:

| Command | Does |
| --- | --- |
| `/task ...` | Create a task |
| `/project ...` | Create a project |
| `/remember ...` | Store a durable memory or thought |
| `/decision ...` | Record a decision |
| `/principle ...` | Record an operating principle |
| `/ask ...` | Ask Skippy from your stored context |
| `/focus` | Summarize or refresh your focus |
| `/interview ...` | Start a guided check-in |
| `/inbox ...` | Send an uncertain item to Review |
| `/link ...` | Link two entities or memories |
| `/plan ...` | Decompose a project into task briefs |
| `/next` | Show the next ready-to-execute task(s) |
| `/brief ...` | Get a task's execution brief |
| `/result ...` | Report an executed task's outcome |
| `/done ...` | Mark a task done |

---

## 7. Tips

- **Set goals** (Brain → Goals). Active goals and in-progress projects shape Skippy's sense of what's important when it triages incoming knowledge.
- **Keep the human in the loop.** External actions always wait for your approval in Review, and task results default to "In review" rather than auto-completing.
- **Old projects work too.** Tasks created before v2 still display and function. To bring an existing project into the new dependency-aware flow, just click **Plan with AI** on it.
- **No AI provider yet?** Capture, review, contacts, goals, interviews, and manual task tracking all work without one. Only automated planning and AI focus summaries need a provider.
