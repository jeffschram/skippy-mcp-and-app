"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { MindGraph } from "../../../../convex/mindGraphHelpers";
import { KINDS, type Position } from "./graph-layout";

type Props = {
  graph: MindGraph;
  positions: Map<string, Position>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  reset: number;
};
function CameraReset({
  reset,
  radius,
  center,
}: {
  reset: number;
  radius: number;
  center: Position;
}) {
  const { camera, controls, invalidate, size } = useThree();
  useEffect(() => {
    const orbit = controls as unknown as {
      target: THREE.Vector3;
      update: () => void;
    } | null;
    const distance =
      (radius * 2.9) / Math.min(1, size.width / Math.max(1, size.height));
    camera.position.set(
      center[0] + distance * 0.09,
      center[1] + distance * 0.06,
      center[2] + distance,
    );
    camera.lookAt(...center);
    orbit?.target.set(...center);
    orbit?.update();
    invalidate();
  }, [
    reset,
    radius,
    center,
    camera,
    controls,
    invalidate,
    size.width,
    size.height,
  ]);
  return null;
}
function Network({ graph, positions, selected, onSelect, reset }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const connected = useMemo(() => {
    const ids = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === selected) ids.add(e.target);
      if (e.target === selected) ids.add(e.source);
    }
    return ids;
  }, [graph.edges, selected]);
  const degree = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of graph.edges) {
      m.set(e.source, (m.get(e.source) || 0) + 1);
      m.set(e.target, (m.get(e.target) || 0) + 1);
    }
    return m;
  }, [graph.edges]);
  const prominent = useMemo(
    () =>
      new Set(
        [...graph.nodes]
          .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
          .slice(0, 4)
          .map((n) => n.id),
      ),
    [graph.nodes, degree],
  );
  const geometry = useMemo(() => {
    const normal: number[] = [],
      active: number[] = [];
    for (const e of graph.edges) {
      const a = positions.get(e.source),
        b = positions.get(e.target);
      if (a && b)
        (e.source === selected || e.target === selected ? active : normal).push(
          ...a,
          ...b,
        );
    }
    return [normal, active].map((points) =>
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3),
      ),
    );
  }, [graph.edges, positions, selected]);
  useEffect(() => () => geometry.forEach((g) => g.dispose()), [geometry]);
  const { radius, center } = useMemo(() => {
    const points = graph.nodes.map(
      (n) => new THREE.Vector3(...positions.get(n.id)!),
    );
    const box = new THREE.Box3().setFromPoints(points);
    const midpoint = box.getCenter(new THREE.Vector3());
    return {
      center: midpoint.toArray() as Position,
      radius: Math.max(4, ...points.map((p) => p.distanceTo(midpoint))),
    };
  }, [positions, graph.nodes]);
  return (
    <>
      <ambientLight intensity={1.8} />
      <pointLight position={[20, 30, 40]} intensity={70} />
      <lineSegments geometry={geometry[0]!}>
        <lineBasicMaterial
          color="#7796bc"
          transparent
          opacity={selected ? 0.09 : 0.25}
          depthWrite={false}
        />
      </lineSegments>
      <lineSegments geometry={geometry[1]!}>
        <lineBasicMaterial
          color="#d0e9ff"
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </lineSegments>
      {graph.nodes.map((node) => {
        const active = node.id === selected,
          hover = node.id === hovered,
          dim = Boolean(selected && !active && !connected.has(node.id));
        const size =
          0.28 + Math.min(0.48, Math.sqrt(degree.get(node.id) || 0) * 0.09);
        return (
          <group key={node.id} position={positions.get(node.id)!}>
            <mesh
              scale={active ? 1.5 : hover ? 1.25 : 1}
              onClick={(e) => {
                e.stopPropagation();
                if (e.delta < 5) onSelect(node.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(node.id);
              }}
              onPointerOut={() => setHovered(null)}
            >
              <sphereGeometry args={[size, 16, 12]} />
              <meshStandardMaterial
                color={KINDS[node.kind].color}
                emissive={KINDS[node.kind].color}
                emissiveIntensity={active || hover ? 1.5 : 0.45}
                transparent
                opacity={dim ? 0.18 : 1}
              />
            </mesh>
            {active && (
              <mesh>
                <sphereGeometry args={[size * 2.3, 20, 16]} />
                <meshBasicMaterial
                  color={KINDS[node.kind].color}
                  wireframe
                  transparent
                  opacity={0.2}
                />
              </mesh>
            )}
            {(active || hover || (!selected && prominent.has(node.id))) && (
              <Html
                center
                position={[0, size + 0.5, 0]}
                style={{ pointerEvents: "none" }}
                zIndexRange={[20, 0]}
              >
                <span
                  className={`mind-node-label ${active ? "is-selected" : ""}`}
                >
                  {node.title.length > 42
                    ? node.title.slice(0, 40) + "…"
                    : node.title}
                </span>
              </Html>
            )}
          </group>
        );
      })}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={3}
        maxDistance={220}
      />
      <CameraReset reset={reset} radius={radius} center={center} />
    </>
  );
}
export default function MindScene(props: Props) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ position: [12, 8, 70], fov: 48, near: 0.1, far: 600 }}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => props.onSelect(null)}
      fallback={
        <p className="mind-fallback">
          Interactive 3D mind map. Use List view to explore the same records
          without the canvas.
        </p>
      }
    >
      <Network {...props} />
    </Canvas>
  );
}
