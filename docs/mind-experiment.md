# Mind experiment

Branch: `feature/mind-v2`

Page: `/mind` (a separate navigation item from Brain)

Mind places the signed-in user at the center of a 3D sphere of individual records. The categories are goals, projects, tasks, people, companies, and all four unified Knowledge kinds. Whole, softly rounded solids and colors identify categories, with no category nodes in the scene. Faint lines connect records to the user; selecting a record highlights its saved relationships separately. The detail panel gives their direction and type. No relationship records are created or inferred. Archived records and their edges are excluded.

## Exploration

- Drag to orbit; scroll or pinch to zoom; right-drag or use a two-finger gesture to pan.
- Select a category in the sidebar to browse its records. Select a record to inspect its description and saved connections; select a connection to follow it.
- My world returns to the full sphere with the user centered.
- Search record titles and summaries, or toggle record types.
- Selecting a record automatically frames it and its direct saved connections. Unrelated forms remain visible at 7% opacity. Camera bounds exclude the central owner anchor unless it is selected, and use projected form extents rather than a bounding sphere for a tighter fit. Clicking empty canvas or pressing Escape restores the opening view. There is no separate Explore action.
- Switch to List for keyboard-accessible browsing or when WebGL is unavailable.
- Open in Skippy leads to the record detail or its existing collection page.

## Scope and implementation

- React Three Fiber 9 / Three.js, with Drei controls and HTML labels; loaded only on the client on this page.
- Styling is scoped to Mind using Tailwind and `mind-classes.ts`. A warm ivory canvas, serif wordmark, teal, vermilion, ochre, and sage follow the Site direction. Search, type filters, List view and Browse remain available; record details appear in an overlay only on selection. On narrow screens the inspector becomes a scrollable bottom panel. Escape closes the selection.
- `mind-geometry.ts` creates one shared geometry per type: rounded cubes (projects), softly rounded square-base pyramids (tasks), complete torus rings (goals), spheres (people), tall rounded cylinders (companies), softened octahedra (memories), thin rounded tablets (notes), bevelled crosses (links), and horizontal capsules (knowledge objects). The owner is a larger warm ivory sphere with gentle golden emission. There are no arches, hemispheres, or other partial solids. Matte lit materials show rounded edges without external models, textures, postprocessing, or shadow-map passes.
- Deterministic spherical positions remain stable under filtering. The opening camera is deliberately close and may crop foreground forms; scroll to zoom out. Search and explicit category/connection views reframe their visible records and owner; My world restores the close opening view. Record geometry, scale, and orientation stay stable while filtering; apparent size varies with depth. Sizes reflect distinct saved neighbors in the full fetched sample: 0–1 = 0.8×, 2–4 = 1.3×, 5–9 = 2×, 10+ = 3×. Structural owner spokes and duplicate relationships do not inflate the count.
- Shared geometries, capped pixel ratio, batched connection segments, on-demand rendering, and transient animation refs limit rendering work. Saved connections appear faintly at rest and strengthen on selection; structural owner links remain much fainter and are never treated as saved relationships. Selection gently scales the chosen form and fades unrelated records to faint ghosts. Animation completes while rotation is paused, and reduced-motion preferences make transitions immediate and disable initial rotation. Hover or selection reveals labels; selection pauses automatic orbiting.
- The root uses the signed-in account. A unique matching email, or a unique matching display name when there is no email match, identifies the corresponding person in the loaded sample. That person is represented by the root instead of appearing twice. Ambiguous matches are left separate; this does not persist an account/contact association.
- `memoryGraph:mindMapForViewer` is read-only and resolves the signed-in user's owned brain. It queries only that brain's accepted records and relationships.
- Knowledge uses the canonical table; legacy IDs resolve to canonical nodes. Duplicate edges, self-links, and edges with unloaded endpoints are excluded. Isolated records remain visible.
- Current limit: 70 records per kind (630 maximum) and 2,500 relationship rows. A sampling notice appears when either limit is reached. Counts and neighborhoods refer to this sample, not the entire database.
- Phases, files, calendar events, recurrences, financial records, source references, and operational records are outside this first experiment.
- No Contacts refactor or schema changes are included.

## Local validation — Mind V2

- Frontend TypeScript check passed.
- The 14 Mind tests passed, covering graph filtering, archive exclusion, canonical IDs, saved relationships, owner identity, stable spherical positions, and empty data.
- Browser-checked against the existing local app with 119 records around the owner: whole rounded shapes, List browsing, record selection, automatic saved-connection framing, and a phone-width inspector.
- Local branch changes only. No backend changes, publishing, or production deployment were performed for this iteration.

Tasks with archived parent projects are excluded by owner-scoped parent lookups, independent of the displayed project and relationship samples. Standalone tasks and tasks of completed projects remain eligible. This query change is local source only; no backend deployment was run.

Mind now uses the shared attention palette for record color; shape conveys category and size conveys distinct saved neighbors. The owner retains its ivory sphere. The Colors control explains the palette, and record inspectors include the shared attention editor. See `docs/attention.md`.
