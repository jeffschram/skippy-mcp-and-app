import { describe, expect, it } from "vitest";
import { KINDS, type Position } from "./graph-layout";
import type { MindGraph, MindKind } from "../../../../convex/mindGraphHelpers";
import { relationshipPositions, layoutKey } from "./relationship-layout";
const kinds=Object.keys(KINDS) as MindKind[];
const nodes=kinds.flatMap((kind,i)=>[0,1].map(j=>({id:`${i}:${j}`,kind,title:kind,summary:"",status:"",href:"/"})));
const edges=kinds.map((_,i)=>({id:`e${i}`,source:`${i}:0`,target:`${i}:1`,type:"related_to"}));
const graph: MindGraph={nodes,edges,limited:false};
const distance=(a:Position,b:Position)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
describe("relationship neighborhoods",()=>{
  it("brings linked records closer for every category",()=>{
    const linked=relationshipPositions(graph), unlinked=relationshipPositions({...graph,edges:[]});
    for(const edge of edges) expect(distance(linked.get(edge.source)!,linked.get(edge.target)!)).toBeLessThan(distance(unlinked.get(edge.source)!,unlinked.get(edge.target)!));
  });
  it("is deterministic across input ordering and duplicate links",()=>{
    const original=relationshipPositions(graph);
    expect(relationshipPositions({...graph,nodes:[...nodes].reverse(),edges:[...edges].reverse()})).toEqual(original);
    expect(relationshipPositions({...graph,edges:[...edges,...edges]})).toEqual(original);
    expect(layoutKey({...graph,nodes:[...nodes].reverse()})).toBe(layoutKey(graph));
  });
  it("keeps the owner fixed and has finite separated positions",()=>{
    const positions=relationshipPositions(graph);
    expect(positions.get("owner:self")).toEqual([0,0,0]);
    for(const p of positions.values()) expect(p.every(Number.isFinite)).toBe(true);
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) expect(distance(positions.get(nodes[i]!.id)!,positions.get(nodes[j]!.id)!)).toBeGreaterThan(2.8);
  });
  it("keeps parent links closer than general associations",()=>{
    const pair={...graph,nodes:nodes.slice(0,2),edges:edges.slice(0,1)};
    const general=relationshipPositions(pair), parent=relationshipPositions({...pair,edges:pair.edges.map(e=>({...e,type:"belongs_to"}))});
    expect(distance(parent.get("0:0")!,parent.get("0:1")!)).toBeLessThan(distance(general.get("0:0")!,general.get("0:1")!));
  });
});
