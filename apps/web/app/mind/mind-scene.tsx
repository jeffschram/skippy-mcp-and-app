"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { mindFallbackClass, mindControlClass } from "./mind-classes";
import { selectionIds, nodeVisualSize, type WorldGraph } from "./my-world";
import { KINDS, type Position } from "./graph-layout";
import { createMindGeometries } from "./mind-geometry";

type Props = {
  graph: WorldGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  reset: number;
  focusKey?: string;
};

function CameraReset({ reset, graph, focusKey, selected, reducedMotion, onMoving }: Pick<Props, "reset" | "graph" | "focusKey" | "selected"> & { reducedMotion: boolean; onMoving: (moving: boolean) => void }) {
  const { camera, controls, invalidate, size } = useThree();
  const destination = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const latestGraph = useRef(graph);
  latestGraph.current = graph;
  useEffect(() => {
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (type: string, listener: () => void) => void; removeEventListener: (type: string, listener: () => void) => void } | null;
    if (!orbit) return;
    const center = new THREE.Vector3();
    let distance = 85 / Math.min(1, size.width / Math.max(1, size.height));
    const current = latestGraph.current;
    const ids = selectionIds(current, selected);
    if (ids.size || focusKey) {
      const points = [...current.positions.entries()]
        .filter(([id]) => (!ids.size || ids.has(id)) && (!selected || selected === current.ownerId || id !== current.ownerId))
        .map(([, point]) => new THREE.Vector3(...point));
      new THREE.Box3().setFromPoints(points).getCenter(center);
      // Fit the highlighted forms in screen space. A bounding sphere would count
      // their depth as extra height and pull the camera unnecessarily far back.
      const availableWidth = selected && size.width > 700 ? Math.max(240, size.width - 380) : size.width;
      const aspect = availableWidth / Math.max(1, size.height);
      const vertical = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
      const horizontal = vertical * aspect;
      const padding = Math.max(2.5, ...current.nodes
        .filter(node => (!ids.size || ids.has(node.id)) && (!selected || selected === current.ownerId || node.id !== current.ownerId))
        .map(node => nodeVisualSize(node) * 1.5));
      distance = Math.max(6, ...points.map(point => {
        const relative = point.clone().sub(center);
        return relative.z + Math.max(
          (Math.abs(relative.x) + padding) / horizontal,
          (Math.abs(relative.y) + padding) / vertical,
        );
      })) * 1.08;
      if (selected && size.width > 700) center.x += distance * vertical * 190 / size.height;
    }
    const position = center.clone().add(selected || focusKey ? new THREE.Vector3(0, 0, distance) : new THREE.Vector3(3, 3, distance));
    if (reducedMotion) {
      camera.position.copy(position); orbit.target.copy(center); orbit.update();
      destination.current = null; onMoving(false);
    } else {
      destination.current = { position, target: center }; onMoving(true);
    }
    invalidate();
    const cancel = () => { destination.current = null; onMoving(false); };
    orbit.addEventListener("start", cancel);
    return () => orbit.removeEventListener("start", cancel);
  }, [reset, selected, focusKey, reducedMotion, camera, controls, invalidate, size.width, size.height, onMoving]);
  useFrame((_, delta) => {
    const goal = destination.current;
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!goal || !orbit) return;
    const alpha = 1 - Math.exp(-6 * Math.min(delta, .05));
    camera.position.lerp(goal.position, alpha);
    orbit.target.lerp(goal.target, alpha);
    if (camera.position.distanceToSquared(goal.position) < .0001 && orbit.target.distanceToSquared(goal.target) < .0001) {
      camera.position.copy(goal.position); orbit.target.copy(goal.target);
      destination.current = null; onMoving(false);
    }
    orbit.update(); invalidate();
  });
  return null;
}

function Network({ graph, selected, onSelect, reset, focusKey = "", rotating, reducedMotion }: Props & { rotating: boolean; reducedMotion: boolean }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const bodies = useRef(new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>());
  const { invalidate } = useThree();
  const shapes = useMemo(createMindGeometries, []);
  useEffect(() => () => Object.values(shapes).forEach(g => g.dispose()), [shapes]);
  const [cameraMoving, setCameraMoving] = useState(false);
  const connected = useMemo(() => selectionIds(graph, selected), [graph, selected]);
  const colors = useMemo(() => new Map(graph.nodes.map(node => {
    const color = new THREE.Color(node.color);
    if (selected && node.id !== selected && !connected.has(node.id)) color.lerp(new THREE.Color("#b7b0a1"), .72);
    return [node.id, color];
  })), [graph.nodes, selected, connected]);
  const lines = useMemo(() => {
    const branches: number[] = [], saved: number[] = [];
    const connections: { source: string; target: string; a: Position; b: Position; progress: number; reversed: boolean }[] = [];
    for (const edge of graph.edges) {
      const a = graph.positions.get(edge.source), b = graph.positions.get(edge.target);
      if (!a || !b) continue;
      if (edge.role === "branch") branches.push(...a, ...b);
      else {
        saved.push(...a, ...b);
        connections.push({ source: edge.source, target: edge.target, a, b, progress: 0, reversed: false });
      }
    }
    const geometry = (values: number[] | Float32Array) => new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
    return {
      branches: geometry(branches), saved: geometry(saved),
      highlight: geometry(new Float32Array(connections.length * 6)), connections,
    };
  }, [graph.edges, graph.positions]);
  useEffect(() => () => { lines.branches.dispose(); lines.saved.dispose(); lines.highlight.dispose(); }, [lines]);
  useFrame((_, delta) => {
    let moving = false;
    const ease = (current: number, target: number) => {
      if (reducedMotion || Math.abs(current - target) < .001) return target;
      moving = true;
      return THREE.MathUtils.damp(current, target, 9, Math.min(delta, .05));
    };
    for (const node of graph.nodes) {
      const body = bodies.current.get(node.id);
      if (!body) continue;
      const target = colors.get(node.id)!;
      const color = body.material.color;
      color.setRGB(ease(color.r, target.r), ease(color.g, target.g), ease(color.b, target.b));
      const ghost = connected.size > 0 && !connected.has(node.id);
      body.material.opacity = ease(body.material.opacity, ghost ? .07 : 1);
      body.material.depthWrite = !ghost;
      body.renderOrder = ghost ? 1 : 2;
      body.scale.setScalar(ease(body.scale.x, node.id === selected ? 1.12 : node.id === hovered ? 1.07 : 1));
    }
    const attr = lines.highlight.getAttribute("position") as THREE.BufferAttribute;
    for (const [i, link] of lines.connections.entries()) {
      const active = link.source === selected || link.target === selected;
      if (active) link.reversed = link.target === selected;
      link.progress = ease(link.progress, active ? 1 : 0);
      const a = link.reversed ? link.b : link.a, b = link.reversed ? link.a : link.b;
      attr.setXYZ(i * 2, ...a);
      attr.setXYZ(i * 2 + 1, THREE.MathUtils.lerp(a[0], b[0], link.progress), THREE.MathUtils.lerp(a[1], b[1], link.progress), THREE.MathUtils.lerp(a[2], b[2], link.progress));
    }
    attr.needsUpdate = true;
    if (moving) invalidate();
  });
  return <>
    <color attach="background" args={["#f0e9dc"]} />
    <fog attach="fog" args={["#f0e9dc", 64, 150]} />
    <ambientLight intensity={.7} />
    <hemisphereLight args={["#fff9ed", "#9c927e", .9]} />
    <directionalLight position={[12, 25, 30]} intensity={2.2} color="#fff4e5" />
    <directionalLight position={[-20, 8, 5]} intensity={.7} color="#e1efee" />
    <lineSegments geometry={lines.branches}>
      <lineBasicMaterial color="#746c5e" transparent opacity={selected ? .025 : .045} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={lines.saved}>
      <lineBasicMaterial color="#746c5e" transparent opacity={selected ? .035 : .16} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={lines.highlight} frustumCulled={false}>
      <lineBasicMaterial color="#28585b" transparent opacity={.85} depthWrite={false} />
    </lineSegments>
    {graph.nodes.map((node) => {
      const active = node.id === selected, hover = node.id === hovered;
      const size = nodeVisualSize(node);
      const shape = node.kind ? KINDS[node.kind].shape : "owner";
      return <group key={node.id} position={graph.positions.get(node.id)!}>
        <group scale={size} rotation={[.12, .25 + (Array.from(node.id).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5) * .13, shape === "ring" ? -.2 : .08]}>
          <mesh geometry={shapes[shape]} ref={body => { if (body) bodies.current.set(node.id, body as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>); else bodies.current.delete(node.id); }}
            onClick={e => { e.stopPropagation(); if (e.delta < 5) onSelect(node.id); }}
            onPointerOver={e => { e.stopPropagation(); setHovered(node.id); }}
            onPointerOut={() => setHovered(null)}>
            <meshStandardMaterial color={node.color} roughness={node.role === "owner" ? .5 : .72} metalness={0}
              emissive={node.role === "owner" ? "#FFE4B0" : "#000000"} emissiveIntensity={node.role === "owner" ? .3 : 0} transparent />
          </mesh>
        </group>
        {(active || hover) && <Html center position={[0, -size * 1.15, 0]} className="pointer-events-none" zIndexRange={[20, 0]}>
          <span className={cn("block max-w-[240px] select-none rounded-lg bg-[#faf6eced] px-3 py-2 text-[14px] text-[#24333c] shadow-sm", active && "border border-[#286c7033]")}>
            <span className="block truncate font-serif text-[18px]">{node.title}</span>
            <span className="mt-1 block text-[12px] text-[#686457]">{node.kind ? KINDS[node.kind].label : "You"}</span>
          </span>
        </Html>}
      </group>;
    })}
    <OrbitControls makeDefault enableDamping autoRotate={rotating && !hovered && !selected && !cameraMoving} autoRotateSpeed={.16} dampingFactor={.09} minDistance={6} maxDistance={220} />
    <CameraReset reset={reset} graph={graph} focusKey={focusKey} selected={selected} reducedMotion={reducedMotion} onMoving={setCameraMoving} />
  </>;
}

export default function MindScene(props: Props) {
  const [rotating, setRotating] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setRotating(!preference.matches); setReducedMotion(preference.matches); };
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return <div className="relative h-full">
    <Canvas className="h-full" frameloop="demand" dpr={[1, 1.5]} camera={{ position: [3, 3, 85], fov: 48, near: .1, far: 600 }} gl={{ antialias: true, alpha: false }}
      onPointerMissed={(event) => { if (event.button === 0) props.onSelect(null); }}
      fallback={<p className={mindFallbackClass}>Use List view to explore your records without the 3D canvas.</p>}>
      <Network {...props} rotating={rotating} reducedMotion={reducedMotion} />
    </Canvas>

  </div>;
}
