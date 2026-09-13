"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { mindFallbackClass, mindControlClass } from "./mind-classes";
import { highlightedIds, nodeVisualSize, type WorldGraph } from "./my-world";
import { KINDS, type Position } from "./graph-layout";
import { createMindGeometries } from "./mind-geometry";

const ignorePointerHits: THREE.Mesh["raycast"] = () => {};

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
    const ids = highlightedIds(current, selected);
    if (current.searchIds !== undefined && !ids.size) return;
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

function Network({ graph, selected, onSelect, reset, focusKey = "", rotating, reducedMotion, dark }: Props & { rotating: boolean; reducedMotion: boolean; dark: boolean }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const groups = useRef(new Map<string, THREE.Group>());
  const bodies = useRef(new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>());
  const { invalidate } = useThree();
  const shapes = useMemo(createMindGeometries, []);
  useEffect(() => () => Object.values(shapes).forEach(g => g.dispose()), [shapes]);
  const [cameraMoving, setCameraMoving] = useState(false);
  const connected = useMemo(() => highlightedIds(graph, selected), [graph, selected]);
  const focused = graph.searchIds !== undefined || connected.size > 0;
  useEffect(() => {
    if (hovered && focused && !connected.has(hovered)) setHovered(null);
  }, [connected, hovered, focused]);
  const colors = useMemo(() => new Map(graph.nodes.map(node => {
    const color = new THREE.Color(node.role === "owner" && dark ? "#253C43" : node.color);
    if (focused && !connected.has(node.id)) color.lerp(new THREE.Color(dark ? "#788781" : "#b7b0a1"), .72);
    return [node.id, color];
  })), [graph.nodes, focused, connected, dark]);
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
      const group = groups.current.get(node.id);
      const destination = graph.positions.get(node.id);
      if (group && destination) group.position.set(
        ease(group.position.x, destination[0]), ease(group.position.y, destination[1]), ease(group.position.z, destination[2]),
      );
      const target = colors.get(node.id)!;
      const color = body.material.color;
      color.setRGB(ease(color.r, target.r), ease(color.g, target.g), ease(color.b, target.b));
      const ghost = focused && !connected.has(node.id);
      body.material.opacity = ease(body.material.opacity, node.id === graph.exitingId ? 0 : ghost ? .07 : 1);
      body.material.depthWrite = !ghost;
      body.renderOrder = ghost ? 1 : 2;
      body.scale.setScalar(ease(body.scale.x, node.id === selected ? 1.12 : !ghost && node.id === hovered ? 1.07 : 1));
    }
    let branchIndex = 0, savedIndex = 0;
    for (const edge of graph.edges) {
      const a = groups.current.get(edge.source)?.position, b = groups.current.get(edge.target)?.position;
      if (!a || !b) continue;
      const geometry = edge.role === "branch" ? lines.branches : lines.saved;
      const index = edge.role === "branch" ? branchIndex++ : savedIndex++;
      const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
      attribute.setXYZ(index * 2, a.x, a.y, a.z); attribute.setXYZ(index * 2 + 1, b.x, b.y, b.z);
      attribute.needsUpdate = true;
    }
    const attr = lines.highlight.getAttribute("position") as THREE.BufferAttribute;
    for (const [i, link] of lines.connections.entries()) {
      const active = (link.source === selected || link.target === selected) && link.source !== graph.exitingId && link.target !== graph.exitingId;
      if (active) link.reversed = link.target === selected;
      link.progress = ease(link.progress, active ? 1 : 0);
      const source = groups.current.get(link.source)?.position.toArray() ?? link.a;
      const target = groups.current.get(link.target)?.position.toArray() ?? link.b;
      const a = (link.reversed ? target : source) as Position, b = (link.reversed ? source : target) as Position;
      attr.setXYZ(i * 2, ...a);
      attr.setXYZ(i * 2 + 1, THREE.MathUtils.lerp(a[0], b[0], link.progress), THREE.MathUtils.lerp(a[1], b[1], link.progress), THREE.MathUtils.lerp(a[2], b[2], link.progress));
    }
    attr.needsUpdate = true;
    if (moving) invalidate();
  });
  return <>
    <color attach="background" args={[dark ? "#171a1b" : "#f0e9dc"]} />
    <fog attach="fog" args={[dark ? "#171a1b" : "#f0e9dc", 64, 150]} />
    <ambientLight intensity={.7} />
    <hemisphereLight args={["#fff9ed", "#9c927e", .9]} />
    <directionalLight position={[12, 25, 30]} intensity={2.2} color="#fff4e5" />
    <directionalLight position={[-20, 8, 5]} intensity={.7} color="#e1efee" />
    <lineSegments geometry={lines.branches} frustumCulled={false}>
      <lineBasicMaterial color={dark ? "#a8b9b1" : "#746c5e"} transparent opacity={focused ? .025 : .045} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={lines.saved} frustumCulled={false}>
      <lineBasicMaterial color={dark ? "#a8b9b1" : "#746c5e"} transparent opacity={focused ? .035 : .16} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={lines.highlight} frustumCulled={false}>
      <lineBasicMaterial color={dark ? "#a0dad3" : "#28585b"} transparent opacity={.85} depthWrite={false} />
    </lineSegments>
    {graph.nodes.map((node) => {
      const ghost = focused && !connected.has(node.id);
      const exiting = node.id === graph.exitingId;
      const active = node.id === selected, hover = !ghost && !exiting && node.id === hovered;
      const size = nodeVisualSize(node);
      const shape = node.kind ? KINDS[node.kind].shape : "owner";
      const labelColor = node.role === "owner" && dark ? "#253C43" : node.color;
      const labelRgb = new THREE.Color(labelColor);
      // Three converts sRGB hex colors to linear channels for luminance.
      const luminance = .2126 * labelRgb.r + .7152 * labelRgb.g + .0722 * labelRgb.b;
      const labelText = luminance > .179 ? "#000000" : "#FFFFFF";
      return <group key={node.id} ref={group => {
        if (group) {
          if (!("mindPositioned" in group.userData)) { group.position.set(...graph.positions.get(node.id)!); group.userData.mindPositioned = true; }
          groups.current.set(node.id, group);
        } else groups.current.delete(node.id);
      }}>
        <group scale={size} rotation={[.12, .25 + (Array.from(node.id).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5) * .13, shape === "ring" ? -.2 : .08]}>
          {!exiting && node.attentionStatus === "immediate" && <mesh geometry={shapes[shape]} scale={1.17} raycast={() => {}}>
            <meshBasicMaterial color="#FF886E" side={THREE.BackSide} transparent opacity={ghost ? .04 : .65} depthWrite={false} toneMapped={false} />
          </mesh>}
          <mesh geometry={shapes[shape]} raycast={ghost || exiting ? ignorePointerHits : THREE.Mesh.prototype.raycast} ref={body => { if (body) bodies.current.set(node.id, body as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>); else bodies.current.delete(node.id); }}
            onClick={e => { e.stopPropagation(); if (e.delta < 5) onSelect(node.id); }}
            onPointerOver={e => { e.stopPropagation(); setHovered(node.id); }}
            onPointerOut={() => setHovered(null)}>
            <meshStandardMaterial fog={graph.searchIds === undefined || ghost} color={node.role === "owner" && dark ? "#253C43" : node.color} roughness={node.role === "owner" ? .5 : .72} metalness={0}
              emissive={node.role === "owner" ? (dark ? "#31565E" : "#FFE4B0") : "#000000"} emissiveIntensity={node.role === "owner" ? (dark ? .12 : .3) : 0} transparent />
          </mesh>
        </group>
        {!exiting && (active || hover) && <Html center position={[0, -size * 1.15, 0]} className="pointer-events-none" zIndexRange={[20, 0]}>
          <span className="block max-w-[240px] select-none rounded-lg px-3 py-2 text-[14px] shadow-sm" style={{ backgroundColor: labelColor, color: labelText }}>
            <span className="block truncate font-sans text-[15px] font-normal leading-snug">{node.title}</span>
            {node.attentionStatus === "immediate" && <span className="mt-1 block text-[12px]">Needs immediate attention</span>}
          </span>
        </Html>}
      </group>;
    })}
    <OrbitControls makeDefault enableDamping autoRotate={rotating && !hovered && !selected && !cameraMoving} autoRotateSpeed={.16} dampingFactor={.09} minDistance={6} maxDistance={220} />
    <CameraReset reset={reset} graph={graph} focusKey={focusKey} selected={selected} reducedMotion={reducedMotion} onMoving={setCameraMoving} />
  </>;
}

export default function MindScene(props: Props) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
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
      <Network {...props} rotating={rotating} reducedMotion={reducedMotion} dark={dark} />
    </Canvas>

  </div>;
}
