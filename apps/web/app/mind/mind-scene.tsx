"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mindFallbackClass } from "./mind-classes";
import { highlightedIds, type WorldGraph } from "./my-world";
import { KINDS, type Position } from "./graph-layout";
import { createArtGeometries, createPaperTexture, applyPaperGrain, artOutline } from "./bauhaus-materials";
import { ART_CAMERA_Z, artSize, artRotation, artConnection, composeArtwork, projectedRadius } from "./bauhaus-layout";

const ignorePointerHits: THREE.Mesh["raycast"] = () => {};

type Props = {
  graph: WorldGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  reset: number;
  focusKey?: string;
};

function CameraReset({ reset, graph, focusKey, selected, reducedMotion, onMoving }: Pick<Props, "reset" | "graph" | "focusKey" | "selected"> & { reducedMotion: boolean; onMoving: (moving: boolean) => void }) {
  const { camera, controls, invalidate, size, gl } = useThree();
  const destination = useRef<{ zoom: number; x: number; y: number } | null>(null);
  const offset = useRef({x:0,y:0});
  useEffect(() => {
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!orbit) return;
    const ids = highlightedIds(graph, selected);
    if (graph.searchIds !== undefined && !ids.size) return;
    const nodes = graph.nodes.filter(node => !ids.size || ids.has(node.id));
    if (!nodes.length) return;
    const bounds = new THREE.Box2();
    for (const node of nodes) {
      const p=graph.positions.get(node.id)!;
      const factor=ART_CAMERA_Z/(ART_CAMERA_Z-p[2]);
      const radius=projectedRadius(node)*1.35;
      bounds.expandByPoint(new THREE.Vector2(p[0]*factor-radius,p[1]*factor-radius));
      bounds.expandByPoint(new THREE.Vector2(p[0]*factor+radius,p[1]*factor+radius));
    }
    const center=bounds.getCenter(new THREE.Vector2()), extent=bounds.getSize(new THREE.Vector2());
    const cardInset=Math.min(150,Math.max(24,(size.width-1280)/2));
    const reserve=selected && size.width>=1024 ? 486+cardInset : 0;
    const top=size.width<640 ? 140 : 105, bottom=size.width<640 ? 230 : 205;
    const availableWidth=Math.max(200,size.width-reserve-64), availableHeight=Math.max(160,size.height-top-bottom);
    const perspective=camera as THREE.PerspectiveCamera;
    const pixels=size.height/(2*ART_CAMERA_Z*Math.tan(THREE.MathUtils.degToRad(perspective.fov/2)));
    const zoom=Math.min(3,availableWidth/Math.max(1,extent.x*pixels),availableHeight/Math.max(1,extent.y*pixels));
    destination.current={zoom,x:center.x*pixels*zoom+reserve/2,y:-center.y*pixels*zoom+(bottom-top)/2};
    camera.position.set(0,0,ART_CAMERA_Z); orbit.target.set(0,0,0); orbit.update();
    onMoving(true); invalidate();
  }, [reset, graph.positions, selected, focusKey, reducedMotion, camera, controls, invalidate, size.width, size.height, onMoving]);
  useEffect(() => {
    const zoom=(event: WheelEvent) => {
      event.preventDefault(); destination.current=null; onMoving(false);
      camera.zoom=THREE.MathUtils.clamp(camera.zoom*Math.exp(-event.deltaY*.001),.08,6);
      camera.updateProjectionMatrix(); invalidate();
    };
    gl.domElement.addEventListener("wheel",zoom,{passive:false});
    return ()=>gl.domElement.removeEventListener("wheel",zoom);
  },[camera,gl,invalidate,onMoving]);
  useFrame((_,delta)=>{
    const goal=destination.current;
    if(!goal) return;
    const alpha=reducedMotion ? 1 : 1-Math.exp(-7*Math.min(delta,.05));
    camera.zoom=THREE.MathUtils.lerp(camera.zoom,goal.zoom,alpha);
    offset.current.x=THREE.MathUtils.lerp(offset.current.x,goal.x,alpha);
    offset.current.y=THREE.MathUtils.lerp(offset.current.y,goal.y,alpha);
    (camera as THREE.PerspectiveCamera).setViewOffset(size.width,size.height,offset.current.x,offset.current.y,size.width,size.height);
    camera.updateProjectionMatrix();
    if(Math.abs(camera.zoom-goal.zoom)<.0001 && Math.abs(offset.current.x-goal.x)+Math.abs(offset.current.y-goal.y)<.01) {
      destination.current=null; onMoving(false);
    }
    invalidate();
  });
  return null;
}

function Network({ graph: sourceGraph, selected, onSelect, reset, focusKey = "", reducedMotion, dark }: Props & { reducedMotion: boolean; dark: boolean }) {
  const topology = JSON.stringify([sourceGraph.nodes.map(n=>[n.id,n.connectionCount]),sourceGraph.edges.map(e=>[e.source,e.target,e.role]),sourceGraph.searchIds,selected]);
  const positions = useMemo(() => {
    const all=composeArtwork(sourceGraph);
    const ids=highlightedIds(sourceGraph,selected);
    if(ids.size) for(const [id,position] of composeArtwork(sourceGraph,ids,selected)) all.set(id,position);
    return all;
  // Status-only updates should not restart composition or camera motion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[topology]);
  const graph={...sourceGraph,positions};
  const artwork=useRef<THREE.Group>(null);
  const parallax=useRef({x:0,y:0});
  const [hovered, setHovered] = useState<string | null>(null);
  const groups = useRef(new Map<string, THREE.Group>());
  const bodies = useRef(new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>());
  const { invalidate, gl } = useThree();
  const shapes = useMemo(createArtGeometries, []);
  const outlines = useMemo(() => Object.fromEntries(Object.entries(shapes).map(([name, geometry]) => [name, artOutline(geometry)])) as Record<keyof typeof shapes, THREE.BufferGeometry>, [shapes]);
  useEffect(() => () => Object.values(outlines).forEach(geometry => geometry.dispose()), [outlines]);
  const paper = useMemo(createPaperTexture, []);
  useEffect(()=>()=>paper.dispose(),[paper]);
  useEffect(()=>{
    const move=(event: PointerEvent)=>{
      const rect=gl.domElement.getBoundingClientRect();
      parallax.current={x:(event.clientX-rect.left)/rect.width*2-1,y:(event.clientY-rect.top)/rect.height*2-1}; invalidate();
    };
    const leave=()=>{parallax.current={x:0,y:0};invalidate();};
    gl.domElement.addEventListener("pointermove",move); gl.domElement.addEventListener("pointerleave",leave);
    return ()=>{gl.domElement.removeEventListener("pointermove",move);gl.domElement.removeEventListener("pointerleave",leave);};
  },[gl,invalidate]);
  useEffect(() => () => Object.values(shapes).forEach(g => g.dispose()), [shapes]);
  const [, setCameraMoving] = useState(false);
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
      highlight: geometry(new Float32Array(connections.length * 18)), connections,
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
    if(artwork.current) {
      artwork.current.rotation.x=ease(artwork.current.rotation.x,reducedMotion ? 0 : parallax.current.y*.004);
      artwork.current.rotation.y=ease(artwork.current.rotation.y,reducedMotion ? 0 : parallax.current.x*.005);
    }
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
      body.material.opacity = ease(body.material.opacity, node.id === graph.exitingId ? 0 : ghost ? .006 : .80);
      // Layer pigments back-to-front, retaining the paper texture in overlaps.
      body.material.depthWrite = false;
      body.renderOrder = ghost ? 1 : 2;
      body.scale.setScalar(ease(body.scale.x, !ghost && node.id === hovered ? 1.025 : 1));
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
    const linked = lines.connections.filter(link => link.source === selected || link.target === selected);
    const quietLinks = new Set(linked.slice(0, linked.length <= 5 ? 5 : 3));
    const nodeMap = new Map(graph.nodes.map(node=>[node.id,node]));
    for (const [i, link] of lines.connections.entries()) {
      const active = (hovered ? link.source === hovered || link.target === hovered : quietLinks.has(link)) && link.source !== graph.exitingId && link.target !== graph.exitingId;
      if (active) link.reversed = link.target === selected;
      link.progress = ease(link.progress, active ? 1 : 0);
      const source = groups.current.get(link.source)?.position.toArray() ?? link.a;
      const target = groups.current.get(link.target)?.position.toArray() ?? link.b;
      const a = (link.reversed ? target : source) as Position, b = (link.reversed ? source : target) as Position;
      const route=artConnection(nodeMap.get(link.reversed ? link.target : link.source)!,nodeMap.get(link.reversed ? link.source : link.target)!,a,b);
      for(let segment=0;segment<3;segment++) {
        const from=route?.[segment] ?? a,to=route?.[segment+1] ?? a;
        const progress=THREE.MathUtils.clamp(link.progress*3-segment,0,1);
        attr.setXYZ(i*6+segment*2,...from);
        attr.setXYZ(i*6+segment*2+1,THREE.MathUtils.lerp(from[0],to[0],progress),THREE.MathUtils.lerp(from[1],to[1],progress),THREE.MathUtils.lerp(from[2],to[2],progress));
      }
    }
    attr.needsUpdate = true;
    if (moving) invalidate();
  });
  return <>
    <color attach="background" args={[dark ? "#171a1b" : "#f0e9dc"]} />
    <group ref={artwork}>
    <lineSegments geometry={lines.branches} frustumCulled={false}>
      <lineBasicMaterial color={dark ? "#a8b9b1" : "#746c5e"} transparent opacity={0} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={lines.saved} frustumCulled={false}>
      <lineBasicMaterial color={dark ? "#a8b9b1" : "#746c5e"} transparent opacity={0} depthWrite={false} />
    </lineSegments>
    <lineSegments geometry={lines.highlight} frustumCulled={false}>
      <lineBasicMaterial color={dark ? "#a0dad3" : "#28585b"} transparent opacity={.42} depthWrite={false} />
    </lineSegments>
    {graph.nodes.map((node) => {
      const ghost = focused && !connected.has(node.id);
      const exiting = node.id === graph.exitingId;
      const active = node.id === selected, hover = !ghost && !exiting && node.id === hovered;
      const size = artSize(node);
      const shape = node.kind ? KINDS[node.kind].shape : "owner";
      const labelColor = node.role === "owner" && dark ? "#253C43" : node.color;
      return <group key={node.id} ref={group => {
        if (group) {
          if (!("mindPositioned" in group.userData)) { group.position.set(...graph.positions.get(node.id)!); group.userData.mindPositioned = true; }
          groups.current.set(node.id, group);
        } else groups.current.delete(node.id);
      }}>
        <group scale={size} rotation={[0, 0, artRotation(node)]}>
          {active && !ghost && !exiting && <lineSegments geometry={outlines[shape]} scale={1.04} raycast={ignorePointerHits}>
            <lineBasicMaterial color={labelColor} transparent opacity={.9} depthWrite={false} toneMapped={false} />
          </lineSegments>}
          {!exiting && node.attentionStatus === "immediate" && <lineSegments geometry={outlines[shape]} scale={1.09} raycast={ignorePointerHits}>
            <lineBasicMaterial color="#FF886E" transparent opacity={ghost ? .03 : .95} depthWrite={false} toneMapped={false} />
          </lineSegments>}
          <mesh geometry={shapes[shape]} raycast={ghost || exiting ? ignorePointerHits : THREE.Mesh.prototype.raycast} ref={body => { if (body) bodies.current.set(node.id, body as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>); else bodies.current.delete(node.id); }}
            onClick={e => { e.stopPropagation(); if (e.delta < 5) onSelect(node.id); }}
            onPointerOver={e => { e.stopPropagation(); setHovered(node.id); }}
            onPointerOut={() => setHovered(null)}>
            <meshBasicMaterial fog={false} map={paper} onBeforeCompile={applyPaperGrain} color={labelColor} transparent toneMapped={false} />
          </mesh>
        </group>
        {!exiting && (active || hover) && <Html center position={[0, -size * 1.15, 0]} className="pointer-events-none" zIndexRange={[20, 0]}>
          <span className="block max-w-[240px] select-none rounded px-2 py-1 text-[12px]" style={{ backgroundColor: dark ? "#171a1be8" : "#f0e9dce8", color: dark ? "#ece8df" : "#24333c" }}>
            <span className="block truncate font-sans text-[12px] font-normal leading-snug">{node.title}</span>
            {node.attentionStatus === "immediate" && <span className="mt-1 block text-[12px]">Needs immediate attention</span>}
          </span>
        </Html>}
      </group>;
    })}
    </group>
    <OrbitControls makeDefault enableDamping enableRotate={false} enableZoom={false} dampingFactor={.09} />
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
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReducedMotion(preference.matches); };
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return <div className="relative h-full">
    <Canvas className="h-full" frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 0, ART_CAMERA_Z], fov: 48, near: .1, far: 600 }} gl={{ antialias: true, alpha: false }}
      onPointerMissed={(event) => { if (event.button === 0) props.onSelect(null); }}
      fallback={<p className={mindFallbackClass}>Use List view to explore your records without the 3D canvas.</p>}>
      <Network {...props} reducedMotion={reducedMotion} dark={dark} />
    </Canvas>

  </div>;
}
