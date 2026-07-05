# Per-Project Folder Settings: Assets & Output

Feature spec + implementation plan for two per-project folder settings — an **Assets folder** (user-provided inputs the agent reads) and an **Output folder** (agent-generated artifacts) — editable in Project Settings, defaulting to `<localPath>/_assets` and `<localPath>/_docs`, with a documented harness workflow contract.

## 1. Overview & motivation

Today a project has exactly one folder concept: `projects.localPath` (`convex/schema.ts:277`, optional string, commented "Local folder path for output files/assets (all projects may have one)"). Everything — the code repo, user-supplied inputs, and agent deliverables — collapses into that single path.

Real precedent: the Danger Gallery remodel task. Its source images (`lounge.png`, `moodboard.png`, `installation-room.png`) were dropped into `docs/danger-gallery-remodel/` **inside this code repo**, and the deliverables (`furniture-plan.md`, `furniture-plan.html`) were written to the same folder. Inputs and artifacts for a non-code task now live untracked inside a software repo's `docs/` tree (visible as `?? docs/danger-gallery-remodel/` in `git status`), polluting the repo and giving the harness no principled answer to "where do I read inputs / write outputs?".

This spec separates the two concerns without breaking the existing single-path model: `localPath` remains the project's base (repo checkout for code projects, plain folder for general ones), and two new optional overrides plus derived defaults tell agents where inputs live and where artifacts go.

## 2. Open questions & decisions (recommendations up top)

1. **Store absolute paths or relative-to-base?** → **Store absolute resolved paths when the user sets an override; store nothing when unset and derive lazily from `localPath`.** No `derived` flag is needed: "unset field" *is* the derived state, which is simpler than a flag and matches how `repoUrl`/`defaultBaseBranch` already behave (optional, absent means "no value"). A stored-relative scheme was rejected: it makes every consumer do path joining with ambiguous semantics (relative to what, when `localPath` is also unset?), and the harness — the only component that can touch the filesystem — would still have to resolve to absolute anyway. Explicit override = absolute path, exactly what the user typed (trimmed); derived default = computed at read time.
2. **Who creates the folders?** → **The harness creates them on first write (`mkdir -p` semantics).** The web app runs in a browser and Convex runs in the cloud; neither can create local directories. Creating `_assets`/`_docs` eagerly for every project would also litter folders that are never used. Lazy creation matches the repo's "lazy cleanup / no grooming" principle.
3. **Who validates paths?** → **The harness validates existence; the app only format-checks.** Convex (cloud) and the browser PWA can never verify that `/Users/jeff/...` exists on the user's machine. The app enforces format only (see §4). The harness, which has filesystem access, is responsible for erroring clearly when a configured path is missing and unresolvable.
4. **Native folder pickers?** → **Not possible; use validated text inputs.** The web app is a browser PWA. `<input type="file" webkitdirectory>` yields sandboxed file handles, not OS paths, and the File System Access API never exposes absolute paths. The UI is a text input with copy-paste guidance (macOS: select folder in Finder, `⌥⌘C` to copy path).
5. **Single PR or split?** → **Single PR.** The change is additive (two optional fields + payload/UI/doc text), every piece is S-scope, and shipping schema without the harness contract would leave the fields meaningless.

## 3. Data model

Current `projects` table (`convex/schema.ts:258-286`), relevant fields:

```ts
kind: v.optional(v.union(v.literal("code"), v.literal("general"))),   // :273
repoUrl: v.optional(v.string()),                                      // :274
defaultBaseBranch: v.optional(v.string()),                            // :275
localPath: v.optional(v.string()),                                    // :277
```

Add two optional fields next to `localPath`:

```ts
// User-provided input files the agent reads (default: <localPath>/_assets).
assetsFolderPath: v.optional(v.string()),
// Agent-generated artifacts (default: <localPath>/_docs).
outputFolderPath: v.optional(v.string()),
```

**Effective-path resolution is lazy, at read time** — per the repo's compose-at-read-time pattern (same architecture as the importance rubric: stored policy + live context composed on read):

```ts
effectiveAssetsPath = assetsFolderPath ?? (localPath ? `${localPath}/_assets` : undefined)
effectiveOutputPath = outputFolderPath ?? (localPath ? `${localPath}/_docs` : undefined)
```

**Why lazy beats backfill:**
- No migration mutation, no touching every existing `projects` row; the optional fields are valid immediately for all documents.
- Defaults track the base automatically: if the user later edits `localPath`, derived paths move with it. A backfilled absolute default would go stale silently.
- "Unset" stays distinguishable from "explicitly set to the default location", so Reset-to-default is a simple field clear.

## 4. Path semantics

- **Absolute paths preferred.** `~`-prefixed paths accepted; **`~` expansion is harness-side only** (the app/Convex never knows the user's home dir).
- macOS/Linux forward-slash paths are canonical. Windows paths (`C:\...`) are accepted and stored as typed; any normalization is display-only. The harness on the target OS interprets them.
- **Trailing slashes stripped on save** (in `updateProjectForViewer`, alongside the existing `.trim()` at `convex/projects.ts:657`). Empty-after-trim clears the field to `undefined`, matching current `localPath` behavior.
- **No existence validation in the app** — browser/cloud cannot see the filesystem. Format validation only: non-empty and starts with `/`, `~`, or a drive letter (`/^[A-Za-z]:[\\/]/`). Anything else is rejected in the mutation with a clear error.
- The derived-default join is a naive `base + "/_assets"` string concat after trailing-slash stripping; that is correct for all accepted forms.

## 5. Settings UI/UX

The editor is the Project Settings `Dialog` in `apps/web/app/hubs/project-board.tsx:809-851`, which today renders `repoUrl`, `defaultBaseBranch`, the local folder field ("Local folder path (output files / assets)", lines 827-829, state `pFolder` at line 112), and saves via `updateProjectForViewer` in `saveSettings` (lines 335-353).

Changes:

- Relabel the existing field to **"Project local folder"** (it is the base, no longer the output dump).
- Add two labeled `TextInput`s below it, mirroring the `pFolder` pattern (`Field` + `TextInput`, new `pAssets`/`pOutput` state seeded in `openSettings`, lines 144-152):
  - **"Assets folder (inputs)"** — placeholder shows the derived default (`<localPath>/_assets`); muted hint below when unset: `default: <base>/_assets`.
  - **"Output folder (artifacts)"** — same with `_docs`.
- **Reset to default** action per field: clears the override (sends empty string; mutation stores `undefined`), falling back to derived.
- **Unset + no base**: when `localPath` is empty, both inputs are disabled with hint *"set the project local folder first"*.
- Copy-paste guidance in the hint text (browser cannot open a native folder picker — see §2.4).
- `saveSettings` passes `assetsFolderPath: pAssets, outputFolderPath: pOutput` to the extended mutation.
- Bonus (optional): `buildBriefText` (lines 50-62) gains `Assets:`/`Output:` lines so the copy-paste brief carries the contract too.

## 6. Agent workflow contract (the important part)

**Contract:** harnesses **read inputs from the effective assets path** and **write deliverables to the effective output path**. An explicit user instruction in the conversation or task brief always overrides both. The harness creates either folder on first write (`mkdir -p`); it never fails a task just because the folder doesn't exist yet. For code projects, code changes still go through the branch → PR flow in the repo at `localPath`; the output folder is for non-code artifacts (plans, reports, renders).

**Payload exposure (computed at read time, never stored):**

- `taskBrief` (`convex/projects.ts:191`) already embeds `project.localPath` at line 220 → add `effectiveAssetsPath` / `effectiveOutputPath` (plus the raw override fields) to that project object. Served by `getTaskBriefForViewer` (:461) and `getTaskBriefForBrain` (:922), i.e. the `get_task_brief` MCP tool.
- `buildBoard` (`convex/projects.ts:33`) project payload includes `localPath` at line 105 → same additions. Served by `projectBoardForViewer` (:400) / `projectBoardForBrain` (:879).
- `currentContext` (`convex/projects.ts:825-843`) — **audit finding:** it returns only `{_id, title, kind, repoUrl}` today, despite `skills/skippy-harness/SKILL.md:80` claiming the local folder is "surfaced in `get_current_context`". Fix while here: add `localPath` + both effective paths to `activeProject`.
- A shared `effectivePaths(project)` helper in `convex/projects.ts` keeps the three call sites consistent.

**Docs:** `buildHarnessBootstrapMessage` (`apps/mcp-server/src/mcp-server.ts:266`, "Core Workflow" list at :334-339) gets one bullet; the `get_task_brief` tool description (:1637-1638) gets one sentence; `skills/skippy-harness/SKILL.md` §"Code projects" (:78-88) gets a convention paragraph:

> Projects expose `effectiveAssetsPath` (user-provided inputs — read from here) and `effectiveOutputPath` (write deliverables here). Defaults derive from the project local folder (`_assets` / `_docs`). Create the folder on first write. Explicit user instructions override these paths.

**Worked examples:**

1. **Danger Gallery (general project).** `localPath: /Users/jeff/projects/danger-gallery`, no overrides. Harness reads mood boards from `/Users/jeff/projects/danger-gallery/_assets`, writes `furniture-plan.md`/`.html` to `.../danger-gallery/_docs` (creating it first). Nothing lands in a code repo.
2. **Code project with an override.** This repo: `localPath: /Users/jeffschram/src/skippy-mcp-and-app`, `outputFolderPath: /Users/jeffschram/Documents/skippy-artifacts`. Code changes → branch + PR in the repo as today (SKILL.md loop, :82-86); the task's written report → `~/Documents/skippy-artifacts`, not `docs/`.
3. **Explicit instruction wins.** Task brief says "save the render to ~/Desktop/preview.png". Harness writes to `~/Desktop/preview.png` (expanding `~` itself) regardless of configured folders, and may note the deviation in `record_task_result`.

## 7. Implementation plan (single PR)

| File | Change | Scope |
|---|---|---|
| `convex/schema.ts` | Add `assetsFolderPath` + `outputFolderPath` optional strings to `projects` (after :277) | S |
| `convex/projects.ts` | `effectivePaths()` helper; extend `updateProjectForViewer` args (:618-661) with trim/strip/format-check; add effective + raw fields to `buildBoard` (:96-106), `taskBrief` (:213-221), `currentContext` (:825-843) | M |
| `apps/web/app/hubs/project-board.tsx` | Two fields in settings dialog (:809-851), `pAssets`/`pOutput` state, `openSettings`/`saveSettings` wiring, reset actions, disabled-without-base state, optional `buildBriefText` lines | M |
| `apps/mcp-server/src/mcp-server.ts` | One Core Workflow bullet in `buildHarnessBootstrapMessage` (:334-339); one sentence in `get_task_brief` description (:1637) | S |
| `skills/skippy-harness/SKILL.md` | Convention paragraph in the code-projects section (:78-88); fix the stale `get_current_context` claim (:80) | S |

No migration, no new mutations, no new components. Recommendation: **one PR**, reviewed as schema → resolution helper → surfaces.

## 8. Verification checklist

Manual (dev deployment + a connected harness):

1. **New project defaults** — create a project, set only the local folder: settings inputs show `_assets`/`_docs` placeholders; `get_task_brief` for one of its tasks returns both effective paths derived from the base.
2. **Legacy project derivation** — an existing project with `localPath` and no new fields (e.g. "Skippy MCP and APP" → `/Users/jeffschram/src/skippy-mcp-and-app`) returns `<localPath>/_assets` / `<localPath>/_docs` with zero data changes.
3. **Explicit overrides** — set both fields to custom absolute paths, save, reload: values persist, effective paths equal the overrides, Reset-to-default clears back to derived.
4. **Unset/invalid behavior** — project with no `localPath`: inputs disabled with the "set the project local folder first" hint, effective paths `undefined` in payloads; saving `foo/bar` (relative) is rejected by the mutation with a format error; trailing slash is stripped on save.

Automated: `pnpm typecheck` (or `tsc -b`) across the workspace; existing convex/web test suites pass unchanged; if `updateProjectForViewer` has mutation tests, add cases for trim/strip/format-reject/clear-to-undefined.
