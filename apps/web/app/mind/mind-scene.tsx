"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
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
      (radius * 2.5) / Math.min(1, size.width / Math.max(1, size.height));
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
function Network({
  graph,
  selected,
  onSelect,
  reset,
  rotating,
  reducedMotion,
}: Props & { rotating: boolean; reducedMotion: boolean }) {
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
  const nodeGroups = useRef(new Map<string, THREE.Group>());
  const { invalidate } = useThree();
  const geometry = useMemo(() => {
    const normal: number[] = [];
    const connections: {
      source: string;
      target: string;
      a: Position;
      b: Position;
      progress: number;
      reversed: boolean;
    }[] = [];
    for (const edge of graph.edges) {
      const a = positions.get(edge.source),
        b = positions.get(edge.target);
      if (!a || !b) continue;
      if (edge.role === "branch") normal.push(...a, ...b);
      else
        connections.push({
          source: edge.source,
          target: edge.target,
          a,
          b,
          progress: 0,
          reversed: false,
        });
    }
    const branches = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(normal, 3),
    );
    const links = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        new Float32Array(connections.length * 6),
        3,
      ),
    );
    return { branches, links, connections };
  }, [graph.edges, positions]);
  useEffect(
    () => () => {
      geometry.branches.dispose();
      geometry.links.dispose();
    },
    [geometry],
  );
  useFrame((_, delta) => {
    let moving = false;
    const ease = (current: number, target: number, speed = 12) => {
      if (reducedMotion || Math.abs(current - target) < 0.001) return target;
      moving = true;
      return THREE.MathUtils.damp(
        current,
        target,
        speed,
        Math.min(delta, 0.05),
      );
    };
    for (const node of graph.nodes) {
      const group = nodeGroups.current.get(node.id);
      if (!group) continue;
      const sphere = group.children[0] as THREE.Mesh<
        THREE.SphereGeometry,
        THREE.MeshBasicMaterial
      >;
      const halo = group.children[1] as THREE.Mesh<
        THREE.SphereGeometry,
        THREE.MeshBasicMaterial
      >;
      const active = node.id === selected,
        hover = node.id === hovered;
      const dim = Boolean(
        selected &&
        node.role === "record" &&
        !active &&
        !connected.has(node.id),
      );
      sphere.scale.setScalar(
        ease(sphere.scale.x, active ? 1.2 : hover ? 1.15 : 1),
      );
      sphere.material.opacity = ease(sphere.material.opacity, dim ? 0.18 : 1);
      halo.material.opacity = ease(halo.material.opacity, active ? 0.2 : 0);
      halo.scale.setScalar(ease(halo.scale.x, active ? 1 : 0.8));
    }
    const attribute = geometry.links.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (const [index, link] of geometry.connections.entries()) {
      const active = link.source === selected || link.target === selected;
      if (active) link.reversed = link.target === selected;
      link.progress = ease(link.progress, active ? 1 : 0, 9);
      const start = link.reversed ? link.b : link.a,
        end = link.reversed ? link.a : link.b;
      attribute.setXYZ(index * 2, ...start);
      attribute.setXYZ(
        index * 2 + 1,
        THREE.MathUtils.lerp(start[0], end[0], link.progress),
        THREE.MathUtils.lerp(start[1], end[1], link.progress),
        THREE.MathUtils.lerp(start[2], end[2], link.progress),
      );
    }
    attribute.needsUpdate = true;
    if (moving) invalidate();
  });
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
      <lineSegments geometry={geometry.branches}>
        <lineBasicMaterial
          color="#7796bc"
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </lineSegments>
      <lineSegments geometry={geometry.links} frustumCulled={false}>
        <lineBasicMaterial
          color="#d0e9ff"
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </lineSegments>
      {graph.nodes.map((node) => {
        const active = node.id === selected,
          hover = node.id === hovered;
        const size = node.role === "owner" ? 1.65 : 0.45;
        return (
          <group
            key={node.id}
            position={positions.get(node.id)!}
            ref={(group) => {
              if (group) nodeGroups.current.set(node.id, group);
              else nodeGroups.current.delete(node.id);
            }}
          >
            <mesh
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
              <meshBasicMaterial
                color={node.color}
                toneMapped={false}
                transparent
                opacity={1}
              />
            </mesh>
            <mesh scale={0.8}>
              <sphereGeometry args={[size * 2.3, 20, 16]} />
              <meshBasicMaterial
                color={node.color}
                wireframe
                transparent
                opacity={0}
                depthWrite={false}
              />
            </mesh>
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
        autoRotate={rotating && !hovered}
        autoRotateSpeed={0.35}
        dampingFactor={0.12}
        minDistance={3}
        maxDistance={220}
      />
      <CameraReset reset={reset} radius={radius} center={center} />
    </>
  );
}
export default function MindScene(props: Props) {
  const [rotating, setRotating] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setRotating(!preference.matches);
      setReducedMotion(preference.matches);
    };
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return (
    <div className="relative h-full">
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
        <Network {...props} rotating={rotating} reducedMotion={reducedMotion} />
      </Canvas>
      <button
        type="button"
        className="absolute left-3 top-3 rounded-md border border-[#ffffff13] bg-[#0b1220cc] px-2.5 py-1.5 text-[11px] text-[#93a7be] hover:bg-[#213952] hover:text-[#eff7ff]"
        onClick={() => setRotating((value) => !value)}
        aria-pressed={rotating}
        aria-label="Auto-rotate map"
      >
        {rotating ? "Pause rotation" : "Resume rotation"}
      </button>
    </div>
  );
}
