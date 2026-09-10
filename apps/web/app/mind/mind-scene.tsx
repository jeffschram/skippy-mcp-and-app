"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { mindFallbackClass } from "./mind-classes";
import type { WorldGraph } from "./my-world";
import { type Position } from "./graph-layout";

type Props = {
  graph: WorldGraph;
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
    camera.position.set(center[0], center[1], center[2] + distance);
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
function Network({ graph, selected, onSelect, reset }: Props) {
  const positions = graph.positions;
  const [hovered, setHovered] = useState<string | null>(null);
  const connected = useMemo(() => {
    const ids = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === selected) ids.add(e.target);
      if (e.target === selected) ids.add(e.source);
    }
    return ids;
  }, [graph.edges, selected]);
  const geometry = useMemo(() => {
    const normal: number[] = [],
      active: number[] = [];
    for (const e of graph.edges) {
      if (
        e.role === "relationship" &&
        e.source !== selected &&
        e.target !== selected
      )
        continue;
      const a = positions.get(e.source),
        b = positions.get(e.target);
      if (a && b)
        (e.role === "relationship" ? active : normal).push(...a, ...b);
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
    const midpoint = new THREE.Vector3();
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
          opacity={0.12}
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
          dim = Boolean(
            selected &&
            node.role === "record" &&
            !active &&
            !connected.has(node.id),
          );
        const size = node.role === "owner" ? 1.65 : 0.45;
        return (
          <group key={node.id} position={positions.get(node.id)!}>
            <mesh
              scale={active ? 1.2 : hover ? 1.15 : 1}
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
                color={node.color}
                emissive={node.color}
                emissiveIntensity={active || hover ? 1.5 : 0.45}
                transparent
                opacity={dim ? 0.18 : 1}
              />
            </mesh>
            {active && (
              <mesh>
                <sphereGeometry args={[size * 2.3, 20, 16]} />
                <meshBasicMaterial
                  color={node.color}
                  wireframe
                  transparent
                  opacity={0.2}
                />
              </mesh>
            )}
            {(node.role !== "record" || active || hover) && (
              <Html
                center
                position={[0, size + 0.5, 0]}
                className="pointer-events-none"
                zIndexRange={[20, 0]}
              >
                <span
                  className={cn(
                    "block max-w-[280px] select-none truncate rounded-[5px] bg-[#0b1220dd] px-[7px] py-[3px] text-[10px] text-[#a7bbd2]",
                    node.role === "owner" &&
                      "px-2 py-1 text-[11px] font-semibold text-[#eff7ff] sm:px-3 sm:py-1.5 sm:text-[14px]",
                    active &&
                      "border border-[#a7ceee50] bg-[#213952] text-[#eff7ff]",
                  )}
                >
                  {node.title.length > 42
                    ? node.title.slice(0, 40) + "…"
                    : node.title}
                  {node.role === "owner" && (
                    <span className="ml-2 hidden text-[9px] uppercase tracking-[0.15em] text-[#a7ceee] sm:inline">
                      You
                    </span>
                  )}
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
      className="h-full"
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ position: [12, 8, 70], fov: 48, near: 0.1, far: 600 }}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => props.onSelect(null)}
      fallback={
        <p className={mindFallbackClass}>
          Interactive 3D mind map. Use List view to explore the same records
          without the canvas.
        </p>
      }
    >
      <Network {...props} />
    </Canvas>
  );
}
