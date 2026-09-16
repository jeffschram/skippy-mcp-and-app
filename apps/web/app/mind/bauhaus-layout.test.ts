import { describe, it, expect } from "vitest";
import { ART_CAMERA_Z, artDepth, artSize, composeArtwork, projectedRadius, artConnection } from "./bauhaus-layout";
import type { WorldGraph, WorldNode } from "./my-world";
const nodes: WorldNode[] = Array.from({length:12},(_,i)=>({id:`n${i}`,title:`Item ${i}`,role:"record",kind:i%2 ? "task" : "project",color:"#659FD7",connectionCount:i%4===0 ? 12 : i%4===1 ? 6 : i%4===2 ? 3 : 1}));
const graph: WorldGraph={nodes,ownerId:"owner",positions:new Map(),edges:[{id:"e",source:"n0",target:"n10",role:"relationship"}]};
const project=(p:number[])=>[p[0]!*ART_CAMERA_Z/(ART_CAMERA_Z-p[2]!),p[1]!*ART_CAMERA_Z/(ART_CAMERA_Z-p[2]!)];
describe("Bauhaus composition",()=>{
  it("keeps importance legible with shallow depth and a capped owner",()=>{
    const tiers=[0,2,5,10].map(connectionCount=>({...nodes[0]!,connectionCount}));
    expect(tiers.map(projectedRadius)).toEqual([2.3,3.5,5,6.8]);
    expect(new Set(tiers.map(artSize)).size).toBe(4);
    expect(projectedRadius({...tiers[3]!,role:"owner"})).toBeLessThan(projectedRadius(tiers[3]!));
    expect(tiers.map(artDepth)).toEqual([0,2,4,6]);
    expect(tiers.every(n=>artDepth(n)<ART_CAMERA_Z)).toBe(true);
  });
  it("is stable across ordering, duplicate links, and status-only changes",()=>{
    expect(composeArtwork({...graph,nodes:[...nodes].reverse(),edges:[...graph.edges,...graph.edges]})).toEqual(composeArtwork(graph));
    expect(composeArtwork({...graph,nodes:nodes.map(n=>({...n,attentionStatus:"immediate"}))})).toEqual(composeArtwork(graph));
  });
  it("keeps saved relationships closer without using synthetic owner spokes",()=>{
    const linked=composeArtwork(graph),unlinked=composeArtwork({...graph,edges:[]});
    const distance=(layout:Map<string,number[]>)=>{const a=project(layout.get("n0")!),b=project(layout.get("n10")!);return Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!);};
    expect(distance(linked)).toBeLessThan(distance(unlinked));
    expect(composeArtwork({...graph,edges:graph.edges.map(e=>({...e,role:"branch"}))})).toEqual(unlinked);
  });
  it("handles empty/singleton focus and finite distinct record positions",()=>{
    expect(composeArtwork(graph,new Set()).size).toBe(0);
    expect(composeArtwork(graph,new Set(["n0"]))).toEqual(new Map([["n0",[0,0,6]]]));
    const positions=[...composeArtwork(graph).values()];
    expect(positions.every(p=>p.every(Number.isFinite))).toBe(true);
    expect(new Set(positions.map(p=>p.join(","))).size).toBe(nodes.length);
  });
  it("gives the selected record a different anchor without changing its size",()=>{
    const ids=new Set(nodes.slice(0,4).map(n=>n.id));
    const primary=composeArtwork(graph,ids,"n0"), other=composeArtwork(graph,ids,"n3");
    expect(primary).not.toEqual(other);
    expect(primary.get("n3")![2]).toBe(other.get("n3")![2]);
  });
  it("keeps focused compositions independent of overview-only records",()=>{
    const ids=new Set(nodes.slice(0,4).map(n=>n.id));
    const focused=composeArtwork(graph,ids,"n0");
    const extra:WorldNode[]=Array.from({length:40},(_,i)=>({...nodes[0]!,id:`unconnected-${i}`,connectionCount:0}));
    const expanded={...graph,nodes:[...nodes,...extra]};
    expect(composeArtwork(expanded,ids,"n0")).toEqual(focused);
    const overview=composeArtwork(expanded);
    expect(overview.size).toBe(expanded.nodes.length);
    expect([...overview.values()].every(p=>p.every(Number.isFinite))).toBe(true);
  });
  it("routes from the boundary of whole shapes and skips overlapping wires",()=>{
    const a={...nodes[0]!,kind:"person" as const,connectionCount:0}, b={...a,id:"b"};
    expect(artConnection(a,b,[0,0,0],[2,0,0])).toBeNull();
    const route=artConnection(a,b,[0,0,0],[12,0,0])!;
    expect(route[0]![0]).toBeGreaterThan(2.3);
    expect(route[3]![0]).toBeLessThan(12-2.3);
    expect(route.every(p=>p.every(Number.isFinite))).toBe(true);
  });
});
