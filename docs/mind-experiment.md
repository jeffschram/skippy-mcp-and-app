# Mind experiment

Branch: `feature/mind-sphere`

Page: `/mind` (a separate navigation item from Brain)

Mind places the signed-in user at the center of a 3D sphere of individual records. The categories are goals, projects, tasks, people, companies, and all four unified Knowledge kinds. Colors identify categories, with no category nodes in the scene. Faint lines connect records to the user; selecting a record highlights its saved relationships separately. The detail panel gives their direction and type. No relationship records are created or inferred. Archived records and their edges are excluded.

## Exploration

- Drag to orbit; scroll or pinch to zoom; right-drag or use a two-finger gesture to pan.
- Select a category in the sidebar to browse its records. Select a record to inspect its description and saved connections; select a connection to follow it.
- My world returns to the full sphere with the user centered.
- Search record titles and summaries, or toggle record types.
- Explore saved connections isolates a record and its direct neighbors, retaining the user at the center. The camera fits the visible nodes around the user.
- Switch to List for keyboard-accessible browsing or when WebGL is unavailable.
- Open in Skippy leads to the record detail or its existing collection page.

## Scope and implementation

- React Three Fiber 9 / Three.js, with Drei controls and HTML labels; loaded only on the client on this page.
- Styling uses Tailwind utilities and shared class strings in `mind-classes.ts`, following `page-classes.ts`. There is no separate Mind stylesheet. Runtime record colors are shared with the Three.js materials.
- Deterministic spherical layout: the user stays at the origin, while Fibonacci directions and varying radii distribute records in all three dimensions. Saved relationships do not influence positions or node sizes. Positions remain stable while filtering. The camera starts closer and slowly orbits by default (pausing during dragging or node hover). A Pause/Resume rotation control is available; reduced-motion preferences disable automatic rotation initially. Rendering occurs on demand as controls change.
- The root uses the signed-in account. A unique matching email, or a unique matching display name when there is no email match, identifies the corresponding person in the loaded sample. That person is represented by the root instead of appearing twice. Ambiguous matches are left separate; this does not persist an account/contact association.
- `memoryGraph:mindMapForViewer` is read-only and resolves the signed-in user's owned brain. It queries only that brain's accepted records and relationships.
- Knowledge uses the canonical table; legacy IDs resolve to canonical nodes. Duplicate edges, self-links, and edges with unloaded endpoints are excluded. Isolated records remain visible.
- Current limit: 70 records per kind (630 maximum) and 2,500 relationship rows. A sampling notice appears when either limit is reached. Counts and neighborhoods refer to this sample, not the entire database.
- Phases, files, calendar events, recurrences, financial records, source references, and operational records are outside this first experiment.
- No Contacts refactor or schema changes are included.

## Validation

- Frontend and Convex TypeScript checks passed.
- All 330 web tests passed, including archive exclusion, graph aliases, filtering, direct user links, spherical distribution, category colors, fixed root, stable positions, saved-edge separation, self-contact remapping, and ambiguous identity matching.
- Browser-checked with development data: Jeff Schram at the root and 116 surrounding records in a sphere with category colors and no category nodes. Category browsing and saved-connection focus were also checked in the preceding iteration.
- The query was installed on the configured Convex **development** deployment with `pnpm exec convex dev --once`. Production was not deployed.

Library references: [React Three Fiber installation](https://r3f.docs.pmnd.rs/getting-started/installation), [Canvas](https://r3f.docs.pmnd.rs/api/canvas), [Drei controls](https://drei.docs.pmnd.rs/controls/introduction).
