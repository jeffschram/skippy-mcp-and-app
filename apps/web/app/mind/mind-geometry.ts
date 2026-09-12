import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import type { MindShape } from "./graph-layout";

/** Shared closed solids. No per-record geometry allocations. */
export function createMindGeometries(): Record<MindShape | "owner", THREE.BufferGeometry> {
  const cylinder = new THREE.LatheGeometry([
    new THREE.Vector2(0, -.9), new THREE.Vector2(.61, -.9),
    new THREE.Vector2(.68, -.87), new THREE.Vector2(.72, -.81),
    new THREE.Vector2(.72, .81), new THREE.Vector2(.68, .87),
    new THREE.Vector2(.61, .9), new THREE.Vector2(0, .9),
  ], 28);
  const pyramid = roundedSolid([
    new THREE.Vector3(0, .95, 0),
    new THREE.Vector3(-.75, -.75, -.75),
    new THREE.Vector3(.75, -.75, -.75),
    new THREE.Vector3(.75, -.75, .75),
    new THREE.Vector3(-.75, -.75, .75),
  ]);
  const octahedron = roundedSolid([
    new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(0, -1.1, 0),
    new THREE.Vector3(.85, 0, 0), new THREE.Vector3(-.85, 0, 0),
    new THREE.Vector3(0, 0, .85), new THREE.Vector3(0, 0, -.85),
  ]);
  // A complete plus-shaped solid distinguishes links from rings and crystals.
  const crossOutline = new THREE.Shape();
  const outline = [[-.27, .9], [.27, .9], [.27, .27], [.9, .27], [.9, -.27], [.27, -.27], [.27, -.9], [-.27, -.9], [-.27, -.27], [-.9, -.27], [-.9, .27], [-.27, .27]];
  outline.forEach(([x, y], i) => { if (i === 0) crossOutline.moveTo(x!, y!); else crossOutline.lineTo(x!, y!); });
  crossOutline.closePath();
  const cross = new THREE.ExtrudeGeometry(crossOutline, {
    depth: .42, bevelEnabled: true, bevelSize: .08, bevelThickness: .08, bevelSegments: 3, steps: 1,
  });
  cross.center();
  cylinder.scale(.9, 1.2, .9);
  return {
    owner: new THREE.SphereGeometry(.9, 40, 28),
    cube: new RoundedBoxGeometry(1.65, 1.65, 1.65, 3, .14),
    pyramid,
    ring: new THREE.TorusGeometry(.83, .27, 12, 36),
    sphere: new THREE.SphereGeometry(.9, 24, 16),
    cylinder,
    octahedron,
    slab: new RoundedBoxGeometry(1.25, 1.95, .3, 3, .12),
    cross,
    capsule: new THREE.CapsuleGeometry(.42, 1.25, 8, 20).rotateZ(Math.PI / 2),
  };
}

/** Rounded convex solids retain broad flat faces and closed, softened edges. */
function roundedSolid(corners: THREE.Vector3[]): THREE.BufferGeometry {
  const rounding = new THREE.SphereGeometry(.07, 12, 8);
  const samples = rounding.getAttribute("position");
  const points = corners.flatMap(corner => Array.from({ length: samples.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(samples, i).add(corner)));
  const geometry = new ConvexGeometry(points);
  rounding.dispose();
  return geometry;
}
