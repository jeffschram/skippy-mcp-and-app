# Mind experiment

Branch: `feature/mind-my-world`

Page: `/mind` (a separate navigation item from Brain)

Mind places the signed-in user at the center of a 3D hierarchy: user → categories → individual records. The categories are goals, projects, tasks, people, companies, and all four unified Knowledge kinds. Category spokes organize the view; selecting a record highlights its saved relationships separately. The detail panel gives their direction and type. No relationship records are created or inferred. Archived records and their edges are excluded.

## Exploration

- Drag to orbit; scroll or pinch to zoom; right-drag or use a two-finger gesture to pan.
- Select a category to browse its records. Select a record to inspect its description and saved connections; select a connection to follow it.
- My world returns to the full hierarchy with the user centered.
- Search record titles and summaries, or toggle record types.
- Explore saved connections isolates a record and its direct neighbors, retaining the user and category structure. The camera fits the visible nodes around the user.
- Switch to List for keyboard-accessible browsing or when WebGL is unavailable.
- Open in Skippy leads to the record detail or its existing collection page.

## Scope and implementation

- React Three Fiber 9 / Three.js, with Drei controls and HTML labels; loaded only on the client on this page.
- Styling uses Tailwind utilities and shared class strings in `mind-classes.ts`, following `page-classes.ts`. There is no separate Mind stylesheet. Runtime record colors are shared with the Three.js materials.
- Deterministic radial layout with depth: the user stays at the origin, categories occupy fixed positions around a ring, and records fan outward from their category. Saved relationships do not influence positions or node sizes. Positions remain stable while filtering. Rendering occurs on demand.
- The root uses the signed-in account. A unique matching email, or a unique matching display name when there is no email match, identifies the corresponding person in the loaded sample. That person is represented by the root instead of appearing twice. Ambiguous matches are left separate; this does not persist an account/contact association.
- `memoryGraph:mindMapForViewer` is read-only and resolves the signed-in user's owned brain. It queries only that brain's accepted records and relationships.
- Knowledge uses the canonical table; legacy IDs resolve to canonical nodes. Duplicate edges, self-links, and edges with unloaded endpoints are excluded. Isolated records remain visible.
- Current limit: 70 records per kind (630 maximum) and 2,500 relationship rows. A sampling notice appears when either limit is reached. Counts and neighborhoods refer to this sample, not the entire database.
- Phases, files, calendar events, recurrences, financial records, source references, and operational records are outside this first experiment.
- No Contacts refactor or schema changes are included.

## Validation

- Frontend and Convex TypeScript checks passed.
- All 329 web tests passed, including archive exclusion, graph aliases, filtering, hierarchy parentage, fixed root, stable positions, saved-edge separation, self-contact remapping, and ambiguous identity matching.
- Browser-checked with development data: Jeff Schram at the root, nine categories, 116 surrounding records, category browsing, Planner details, saved-connection focus, return to My world, and a 390px mobile viewport.
- The query was installed on the configured Convex **development** deployment with `pnpm exec convex dev --once`. Production was not deployed.

Library references: [React Three Fiber installation](https://r3f.docs.pmnd.rs/getting-started/installation), [Canvas](https://r3f.docs.pmnd.rs/api/canvas), [Drei controls](https://drei.docs.pmnd.rs/controls/introduction).
