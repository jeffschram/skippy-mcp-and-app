import type { Position } from "./graph-layout";
import type { WorldGraph, WorldNode } from "./my-world";

export const ART_CAMERA_Z = 60;
export const ART_SIZE = 2.5;
const tier = (node: WorldNode) => { const n=node.connectionCount ?? 0; return n>=10 ? 3 : n>=5 ? 2 : n>=2 ? 1 : 0; };
// Importance controls apparent size; six units of depth add only gentle parallax.
export function artDepth(node: WorldNode): number { return tier(node)*2; }
export function projectedRadius(node: WorldNode): number {
  const radius=[2.3,3.5,5,6.8][tier(node)]!;
  return node.role === "owner" ? Math.min(radius,3.8) : radius;
}
export function artSize(node: WorldNode): number { return projectedRadius(node)*(ART_CAMERA_Z-artDepth(node))/ART_CAMERA_Z; }
export function artRotation(node: WorldNode): number {
  if(node.kind!=="task") return 0;
  return (Array.from(node.id).reduce((sum,ch)=>sum+ch.charCodeAt(0),0)%4)*Math.PI/2;
}
type Point=[number,number];
function order(a:WorldNode,b:WorldNode): number {
  return Number(a.role==="owner")-Number(b.role==="owner") || (b.connectionCount??0)-(a.connectionCount??0) || a.id.localeCompare(b.id);
}

/** Three compositional grammars: stepped structure, overlapping diagonal,
 * and offset columns. The selected record owns the anchor, regardless of size.
 */
function motif(input:WorldNode[], selected?:string): Map<string,Point> {
  const nodes=[...input].sort(order);
  const selectedIndex=nodes.findIndex(n=>n.id===selected);
  if(selectedIndex>0) nodes.unshift(nodes.splice(selectedIndex,1)[0]!);
  if(!nodes.length) return new Map();
  const primary=nodes[0]!, r=projectedRadius(primary);
  const pattern=primary.kind==="project" || primary.kind==="task" ? "steps" : primary.kind==="person" || primary.role==="owner" ? "diagonal" : "columns";
  const points:Point[]=[[0,0]], radii=nodes.map(projectedRadius);
  const anchors:Point[]=[[0,0]];
  for(let i=1;i<nodes.length;i++) {
    const n=radii[i]!, lane=(i-1)%3, row=Math.floor((i-1)/3);
    let point:Point;
    if(pattern==="steps") {
      const slots:Point[]=[[r*.8,r*.65], [r*.85,-r*.65],[-r*.6,-r*.85]];
      const base=slots[lane]!;
      point=[base[0]+row*(n*1.9+2),base[1]-row*(n*.8+1)];
    } else if(pattern==="diagonal") {
      const slots:Point[]=[[r*.7,r*.8],[r*.95,-r*.55],[-r*.45,-r*.95]];
      const base=slots[lane]!;
      point=[base[0]+row*(n*1.7+2),base[1]-row*(n*1.2+2)];
    } else {
      point=[lane===0 ? r*.85 : lane===1 ? -r*.8 : r*.9, (lane===0 ? r*.9 : lane===1 ? -r*.7 : -r*.85)-row*(n*2+2)];
    }
    points.push(point); anchors.push([...point]);
  }
  // Keep meaningful intersections, while ensuring a smaller form cannot be
  // completely buried. Strong anchor springs preserve the chosen composition.
  for(let step=0;step<150;step++) {
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) {
      const a=points[i]!,b=points[j]!;
      let dx=b[0]-a[0],dy=b[1]-a[1];
      if(Math.hypot(dx,dy)<.001) {dx=.03;dy=.02;}
      const distance=Math.hypot(dx,dy);
      const minimum=Math.max(Math.max(radii[i]!,radii[j]!)+Math.min(radii[i]!,radii[j]!)*.18,(radii[i]!+radii[j]!)*.72);
      const push=Math.max(0,minimum-distance)*.48;
      const weight=i===0 ? 1 : .5;
      b[0]+=dx/distance*push*weight; b[1]+=dy/distance*push*weight;
      if(i!==0) {a[0]-=dx/distance*push*.5;a[1]-=dy/distance*push*.5;}
    }
    for(let i=1;i<points.length;i++) for(let axis=0;axis<2;axis++) points[i]![axis]!+=(anchors[i]![axis]!-points[i]![axis]!)*.015;
  }
  return new Map(nodes.map((n,i)=>[n.id,points[i]!]));
}

/** One shared picture plane: large forms establish a diagonal, then every
 * record competes for the same gaps. Relationships attract without enclosing
 * neighborhoods in separate boxes. Focus continues to use its own motifs.
 */
function overview(nodes:WorldNode[], graph:WorldGraph):Map<string,Point> {
  const points=new Map<string,Point>();
  const adjacency=new Map(nodes.map(n=>[n.id,new Set<string>()]));
  for(const edge of graph.edges) if(edge.role==="relationship") {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const area=nodes.reduce((sum,n)=>sum+Math.PI*projectedRadius(n)**2,0);
  const width=Math.max(12,Math.sqrt(area*1.7)*.8),height=width/1.7;
  // Distribute the strongest visual weights across the artwork, not its center.
  const anchors:Point[]=[[-width*.6,height*.36],[width*.02,-height*.02],[width*.6,-height*.36]];
  const anchorCount=Math.min(3,nodes.filter(n=>projectedRadius(n)>=5 && n.role!=="owner").length);
  const placed:WorldNode[]=[];
  for(let index=0;index<nodes.length;index++) {
    const node=nodes[index]!,radius=projectedRadius(node);
    if(index<anchorCount) {
      points.set(node.id,anchors[index]!);placed.push(node);continue;
    }
    const candidates:Point[]=[];
    // A staggered lattice offers shared alignments; dense sampling avoids
    // assigning either categories or unconnected records to their own band.
    const step=2.3;
    for(let row=-Math.ceil(height/step);row<=Math.ceil(height/step);row++) {
      for(let col=-Math.ceil(width/step);col<=Math.ceil(width/step);col++) {
        candidates.push([col*step+(Math.abs(row)%2)*step/2,row*step]);
      }
    }
    for(const other of placed) {
      const p=points.get(other.id)!,r=projectedRadius(other);
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4,d=(r+radius)*(adjacency.get(node.id)?.has(other.id) ? .94 : 1.14);
        candidates.push([p[0]+Math.cos(angle)*d,p[1]+Math.sin(angle)*d]);
      }
    }
    let best:Point=[0,0],bestScore=Infinity;
    for(const candidate of candidates) {
      const [x,y]=candidate;
      const ellipse=(x/width)**2+(y/height)**2;
      let score=ellipse*.1+Math.max(0,ellipse-.9)**2*45;
      let nearest=Infinity,alignment=Infinity;
      let friends=0,friendDistance=0;
      for(const other of placed) {
        const p=points.get(other.id)!,r=projectedRadius(other);
        const dx=x-p[0],dy=y-p[1],distance=Math.hypot(dx,dy);
        const minimum=Math.max(Math.max(r,radius)+Math.min(r,radius)*.2,(r+radius)*.78);
        score+=Math.max(0,minimum-distance)**2*35;
        nearest=Math.min(nearest,Math.abs(distance-(r+radius)*(adjacency.get(node.id)?.has(other.id) ? .96 : 1.14)));
        alignment=Math.min(alignment,Math.abs(dx),Math.abs(dy),Math.abs(Math.abs(dx)-Math.abs(dy))*.7);
        if(adjacency.get(node.id)?.has(other.id)) {
          friends++;friendDistance+=Math.max(0,distance-r-radius)**2;
        }
      }
      if(placed.length) score+=nearest**2*.65+alignment*.18;
      if(friends) score+=friendDistance/friends*.075;
      // Tiny deterministic tie-break, without a random position on refresh.
      score+=Math.abs(x*.013+y*.017+index*.001)*.001;
      if(score<bestScore) {bestScore=score;best=candidate;}
    }
    points.set(node.id,best);placed.push(node);
  }
  return points;
}

export function composeArtwork(graph:WorldGraph, subset?:Set<string>, selected?:string|null):Map<string,Position> {
  const nodes=graph.nodes.filter(n=>!subset || subset.has(n.id)).sort(order);
  const points=subset ? motif(nodes,selected??undefined) : overview(nodes,graph);
  if(!nodes.length) return new Map();
  const bounds=nodes.map(n=>{const p=points.get(n.id)!;return {p,r:projectedRadius(n)};});
  const cx=(Math.min(...bounds.map(({p,r})=>p[0]-r))+Math.max(...bounds.map(({p,r})=>p[0]+r)))/2;
  const cy=(Math.min(...bounds.map(({p,r})=>p[1]-r))+Math.max(...bounds.map(({p,r})=>p[1]+r)))/2;
  return new Map(nodes.map(node=>{const p=points.get(node.id)!,z=artDepth(node),factor=(ART_CAMERA_Z-z)/ART_CAMERA_Z;return [node.id,[(p[0]-cx)*factor,(p[1]-cy)*factor,z] as Position];}));
}

function boundary(node:WorldNode, dx:number, dy:number):number {
  const rotation=-artRotation(node),x=dx*Math.cos(rotation)-dy*Math.sin(rotation),y=dx*Math.sin(rotation)+dy*Math.cos(rotation);
  const radius=projectedRadius(node),length=Math.hypot(x,y);
  if(!length) return 0;
  const d:Point=[x/length,y/length];
  let polygon:Point[];
  switch(node.kind) {
    case "project": polygon=[[-1,-1],[1,-1],[1,1],[-1,1]];break;
    case "task": polygon=[[-1,-.9],[1,-.9],[-1,1.1]];break;
    case "memory":polygon=[[0,1.15],[-.85,0],[0,-1.15],[.85,0]];break;
    case "note":polygon=[[-.35,-1],[.35,-1],[.35,1],[-.35,1]];break;
    case "link":polygon=[[-.3,1],[.3,1],[.3,.3],[1,.3],[1,-.3],[.3,-.3],[.3,-1],[-.3,-1],[-.3,-.3],[-1,-.3],[-1,.3],[-.3,.3]];break;
    default:return radius/(Math.hypot(d[0]/(node.kind==="company"?.65:1),d[1]/(node.kind==="knowledgeObject"?.45:1)));
  }
  const cross=(a:Point,b:Point)=>a[0]*b[1]-a[1]*b[0];
  let hit=Infinity;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,edge:Point=[b[0]-a[0],b[1]-a[1]],denom=cross(d,edge);
    if(Math.abs(denom)<.00001) continue;
    const t=cross(a,edge)/denom,u=cross(a,d)/denom;
    if(t>=0 && u>=0 && u<=1) hit=Math.min(hit,t);
  }
  return (Number.isFinite(hit)?hit:1)*radius;
}

/** Sparse orthogonal routes terminate at silhouettes. Overlaps need no wire. */
export function artConnection(a:WorldNode,b:WorldNode,start:Position,end:Position):Position[] | null {
  const project=(p:Position):Point=>[p[0]*ART_CAMERA_Z/(ART_CAMERA_Z-p[2]),p[1]*ART_CAMERA_Z/(ART_CAMERA_Z-p[2])];
  const pa=project(start),pb=project(end),dx=pb[0]-pa[0],dy=pb[1]-pa[1],distance=Math.hypot(dx,dy);
  const ra=boundary(a,dx,dy),rb=boundary(b,-dx,-dy);
  if(distance<=ra+rb+.5) return null;
  const p:Point=[pa[0]+dx/distance*(ra+.15),pa[1]+dy/distance*(ra+.15)];
  const q:Point=[pb[0]-dx/distance*(rb+.15),pb[1]-dy/distance*(rb+.15)];
  // Edge points come from actual silhouettes; a shared horizontal/vertical rail
  // between them avoids the central starburst while keeping the link explicit.
  const middle=(p[0]+q[0])/2;
  return [p,[middle,p[1]] as Point,[middle,q[1]] as Point,q].map((point,i)=>{
    const z=start[2]+(end[2]-start[2])*i/3,factor=(ART_CAMERA_Z-z)/ART_CAMERA_Z;
    return [point[0]*factor,point[1]*factor,z] as Position;
  });
}
