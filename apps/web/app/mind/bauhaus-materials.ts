import * as THREE from "three";
import type { MindShape } from "./graph-layout";

/** Closed, shallow cut-paper forms. Their large faces remain parallel to the art. */
export function createArtGeometries(): Record<MindShape | "owner", THREE.BufferGeometry> {
  const polygon = (points: number[][]) => {
    const shape=new THREE.Shape();
    points.forEach(([x,y],i)=>i ? shape.lineTo(x!,y!) : shape.moveTo(x!,y!)); shape.closePath();
    return shape;
  };
  const circle = () => { const s=new THREE.Shape(); s.absarc(0,0,1,0,Math.PI*2,false); return s; };
  const ring=circle(), hole=new THREE.Path(); hole.absarc(0,0,.57,0,Math.PI*2,true); ring.holes.push(hole);
  const capsule=new THREE.Shape(); capsule.absarc(.55,0,.45,-Math.PI/2,Math.PI/2,false); capsule.absarc(-.55,0,.45,Math.PI/2,Math.PI*1.5,false); capsule.closePath();
  const cylinder=new THREE.Shape(); cylinder.moveTo(-.65,-.75); cylinder.bezierCurveTo(-.65,-1.08,.65,-1.08,.65,-.75); cylinder.lineTo(.65,.75); cylinder.bezierCurveTo(.65,1.08,-.65,1.08,-.65,.75); cylinder.closePath();
  const forms: Record<MindShape | "owner", THREE.Shape> = {
    owner:circle(),sphere:circle(), cube:polygon([[-1,-1],[1,-1],[1,1],[-1,1]]),
    pyramid:polygon([[-1,-.9],[1,-.9],[-1,1.1]]), ring, cylinder,
    octahedron:polygon([[0,1.15],[-.85,0],[0,-1.15],[.85,0]]),
    slab:polygon([[-.35,-1],[.35,-1],[.35,1],[-.35,1]]),
    cross:polygon([[-.3,1],[.3,1],[.3,.3],[1,.3],[1,-.3],[.3,-.3],[.3,-1],[-.3,-1],[-.3,-.3],[-1,-.3],[-1,.3],[-.3,.3]]),capsule,
  };
  return Object.fromEntries(Object.entries(forms).map(([key,shape]) => {
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.06,bevelEnabled:false,curveSegments:48});
    const position=geometry.getAttribute("position"), uv=geometry.getAttribute("uv");
    for(let i=0;i<uv.count;i++) uv.setXY(i,(position.getX(i)+1.2)/2.4,(position.getY(i)+1.2)/2.4);
    return [key,geometry];
  })) as unknown as Record<MindShape | "owner", THREE.BufferGeometry>;
}

/** Seeded multiscale grain: no external texture request or flickering random noise. */
export function createPaperTexture(): THREE.DataTexture {
  const size=512, data=new Uint8Array(size*size*4);
  let seed=93761;
  const random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const coarse=Array.from({length:32*32},random);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const gx=x/16,gy=y/16,ix=Math.floor(gx),iy=Math.floor(gy);
    const sx=(gx-ix)**2*(3-2*(gx-ix)),sy=(gy-iy)**2*(3-2*(gy-iy));
    const at=(xx:number,yy:number)=>coarse[(yy%32)*32+(xx%32)]!;
    const cloud=THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix,iy),at(ix+1,iy),sx),THREE.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),sx),sy);
    const shade=Math.round(250+cloud*5);
    const i=(y*size+x)*4; data[i]=data[i+1]=data[i+2]=shade; data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace; texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter; texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true; texture.needsUpdate=true;
  return texture;
}

/** Fine screen-space fibers stay fine at every zoom; pigment variation uses UVs. */
export const applyPaperGrain: THREE.MeshBasicMaterial["onBeforeCompile"] = shader => {
  shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>",`#include <map_fragment>
    float paperGrain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    diffuseColor.rgb *= 0.965 + paperGrain * 0.055;
  `);
};

/** Front contours only: no duplicate back edge from the shallow extrusion. */
export function artOutline(geometry:THREE.BufferGeometry):THREE.BufferGeometry {
  const edges=new THREE.EdgesGeometry(geometry),p=edges.getAttribute("position"),values:number[]=[];
  for(let i=0;i<p.count;i+=2) if(p.getZ(i)>.05 && p.getZ(i+1)>.05) values.push(p.getX(i),p.getY(i),.07,p.getX(i+1),p.getY(i+1),.07);
  edges.dispose();
  return new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(values,3));
}
