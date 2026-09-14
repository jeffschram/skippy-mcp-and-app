import type { ReactNode } from "react";
import type { MindKind } from "../../../../convex/mindGraphHelpers";
import { KINDS, type MindShape } from "./graph-layout";

// Small projections of the map's solids, with facets that remain legible at 20px.
const shapes: Record<MindShape, ReactNode> = {
  cube: <><path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" fillOpacity=".16" /><path d="m3 7 9 5 9-5M12 12v10" /></>,
  pyramid: <><path d="m12 2 10 17-10 3-10-5Z" fill="currentColor" fillOpacity=".16" /><path d="m12 2 1 15 9 2M13 17l-1 5M2 17h11" /></>,
  ring: <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" fill="currentColor" fillOpacity=".25" fillRule="evenodd" />,
  sphere: <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".2" /><path d="M7 10a5 5 0 0 1 5-5" opacity=".7" /></>,
  cylinder: <><path d="M5 6v12c0 2 3 3 7 3s7-1 7-3V6" fill="currentColor" fillOpacity=".16" /><ellipse cx="12" cy="6" rx="7" ry="3" /></>,
  octahedron: <><path d="m12 2 9 10-9 10-9-10Z" fill="currentColor" fillOpacity=".16" /><path d="m12 2 3 10-3 10M3 12h18" /></>,
  slab: <><path d="m6 4 10-2 3 2v16l-10 2-3-2Z" fill="currentColor" fillOpacity=".16" /><path d="m6 4 3 2 10-2M9 6v16" /></>,
  cross: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" fill="currentColor" fillOpacity=".2" />,
  capsule: <><rect x="2" y="7" width="20" height="10" rx="5" fill="currentColor" fillOpacity=".2" /><path d="M7 10h7" opacity=".7" /></>,
};

export function MindCategoryIcon({ kind }: { kind: MindKind }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: KINDS[kind].color }} aria-hidden="true" focusable="false">
    {shapes[KINDS[kind].shape]}
  </svg>;
}
