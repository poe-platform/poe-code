import {expect,it,vi} from "vitest";
import type {PdfDisplayList,PdfPathSegment} from "../ast.js";
import {renderDisplayListToBitmap,renderDisplayListWindowSteps} from "./raster.js";

function scene(segments: PdfPathSegment[], fillRule: "nonzero"|"evenodd" = "nonzero", clip = false): PdfDisplayList {
 const path={segments,fillRule,strokeWidth:0,fillColor:{r:1,g:0,b:0},...(clip?{clipPaths:[{segments,fillRule}]}:{})};
 return {pageIndex:0,width:8,height:8,rotation:0,glyphs:[],images:[],annotations:[],paths:[path]};
}
it.each([false,true])("bounds crossing scratch by window width (clip=%s)",clip=>{
 const segments:PdfPathSegment[]=Array.from({length:2048},()=>({kind:"rect",x:0,y:0,width:8,height:8}));
 const Native=Float64Array;
 vi.stubGlobal("Float64Array",new Proxy(Native,{construct(target,args){if(typeof args[0]==="number"&&args[0]>1024)throw Error("edge-sized scratch");return Reflect.construct(target,args);}}));
 try{const work=renderDisplayListWindowSteps(scene(segments,"nonzero",clip),{x:0,y:0,width:8,height:8});let next=work.next();while(!next.done)next=work.next();expect(next.value.data[3]).toBe(255);}finally{vi.unstubAllGlobals();}
});

// Independent sorted-intersection reference preserves inclusive sample endpoints,
// including touching intervals and repeated crossings at an exact sample.
for(const fillRule of ["nonzero","evenodd"] as const)it(`preserves inclusive intersections and winding for ${fillRule}`,()=>{
 let seed=1949;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return (seed%81)/8-1;};
 for(let example=0;example<24;example++){
  const polygons:number[][][]=[];
  for(let shape=0;shape<5;shape++)polygons.push(Array.from({length:5},()=>[random(),random()]));
  // Include zero-width and coincident boundaries exactly on the sample grid.
  polygons.push([[.125,.125],[3.125,.125],[3.125,6.875],[.125,6.875]],[[3.125,.125],[7.875,.125],[7.875,6.875],[3.125,6.875]]);
  const segments:PdfPathSegment[]=polygons.flatMap(points=>[...points.map(([x,y],i)=>({kind:i?"line" as const:"move" as const,x:x!,y:8-y!})),{kind:"close" as const}]);
  const actual=renderDisplayListToBitmap(scene(segments,fillRule),{scale:1,transparent:true,antialiasVector:true});
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   let count=0;
   for(const dy of [.125,.375,.625,.875]){
    const scan=y+dy,crossings:{x:number;direction:number}[]=[];
    for(const points of polygons)for(let i=0;i<points.length;i++){
     const [x0,y0]=points[i]!,[x1,y1]=points[(i+1)%points.length]!;
     if((y0!<=scan&&y1!>scan)||(y1!<=scan&&y0!>scan))crossings.push({x:x0!+(scan-y0!)/(y1!-y0!)*(x1!-x0!),direction:y0!<y1!?1:-1});
    }
    crossings.sort((a,b)=>a.x-b.x);let winding=0,start=0;
    for(const crossing of crossings){const before=winding;winding=fillRule==="evenodd"?1-winding:winding+crossing.direction;
     if(before===0&&winding!==0)start=crossing.x;
     else if(before!==0&&winding===0)for(const dx of [.125,.375,.625,.875])if(x+dx>=start&&x+dx<=crossing.x)count++;
    }
   }
   const alpha=Math.min(255,Math.round(count/16*255));expect(actual.data[(y*8+x)*4+3]).toBe(alpha);
  }
 }
});

it("fills and clips complex paths without collecting projected subpaths or edges",()=>{
 const segments:PdfPathSegment[]=Array.from({length:4096},()=>({kind:"rect",x:0,y:0,width:8,height:8}));
 const push=Array.prototype.push;
 Array.prototype.push=function(this:unknown[],...items:unknown[]){if(this.length+items.length>1024)throw Error("collected path geometry");return push.apply(this,items);};
 let result:Uint8Array|undefined;
 try{const work=renderDisplayListWindowSteps(scene(segments,"nonzero",true),{x:0,y:0,width:8,height:8},{scale:1});let next=work.next();while(!next.done)next=work.next();result=next.value.data;}finally{Array.prototype.push=push;}
 expect(result?.[3]).toBe(255);
});
