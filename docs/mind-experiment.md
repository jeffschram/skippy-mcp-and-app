# Mind experiment

Branch: `experiment/mind-map`

Page: `/mind` (a separate navigation item from Brain)

Mind renders accepted goals, projects, tasks, people, companies, and all four unified Knowledge kinds as a 3D network. Lines represent saved, directed relationships. The detail panel gives their direction and type. It does not create or infer relationships.

## Exploration

- Drag to orbit; scroll or pinch to zoom; right-drag or use a two-finger gesture to pan.
- Select a node to inspect its description and connections; select a connection to follow it.
- Search record titles and summaries, or toggle record types.
- Explore a neighborhood to isolate a record and its direct neighbors; the camera fits the visible nodes.
- Switch to List for keyboard-accessible browsing or when WebGL is unavailable.
- Open in Skippy leads to the record detail or its existing collection page.

## Scope and implementation

- React Three Fiber 9 / Three.js, with Drei controls and HTML labels; loaded only on the client on this page.
- Styling uses Tailwind utilities and shared class strings in `mind-classes.ts`, following `page-classes.ts`. There is no separate Mind stylesheet. Runtime record colors are shared with the Three.js materials.
- Deterministic 3D force layout. Edges attract, nodes repel. Layout positions remain stable while filtering. No continuous animation; rendering occurs on demand.
- `memoryGraph:mindMapForViewer` is read-only and resolves the signed-in user's owned brain. It queries only that brain's accepted records and relationships.
- Knowledge uses the canonical table; legacy IDs resolve to canonical nodes. Duplicate edges, self-links, and edges with unloaded endpoints are excluded. Isolated records remain visible.
- Current limit: 70 records per kind (630 maximum) and 2,500 relationship rows. A sampling notice appears when either limit is reached. Counts and neighborhoods refer to this sample, not the entire database.
- Phases, files, calendar events, recurrences, financial records, source references, and operational records are outside this first experiment.
- No Contacts refactor or schema changes are included.

## Validation

- Frontend and Convex TypeScript checks passed.
- All 323 web tests passed, including graph alias resolution, filtering, isolated nodes, invalid edges, and deterministic layout.
- Browser-checked using development data: 129 records and 66 edges, node selection, search, List view, neighborhood focus, following a relationship, and a 390px mobile viewport.
- The query was installed on the configured Convex **development** deployment with `pnpm exec convex dev --once`. Production was not deployed.

Library references: [React Three Fiber installation](https://r3f.docs.pmnd.rs/getting-started/installation), [Canvas](https://r3f.docs.pmnd.rs/api/canvas), [Drei controls](https://drei.docs.pmnd.rs/controls/introduction).
