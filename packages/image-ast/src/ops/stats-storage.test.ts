import {expect,it,vi} from "vitest";
import {computeImageStatsSteps} from "./transform.js";
import type {RgbaImage} from "../ast.js";

function fixture(width:number,height:number,channels:1|2|3|4,gray=false):RgbaImage {
 return {width,height,channels,space:gray?"b-w":"srgb",hasAlpha:channels===2||channels===4,
 data:Uint8Array.from({length:width*height*4},(_,i)=>(i*37+(i>>>3)*19)%256)};
}
function stats(image:RgbaImage) {
 const steps=computeImageStatsSteps(image);let next=steps.next();
 while(!next.done) next=steps.next();return next.value;
}
for(const [width,height] of [[1,1],[1,17],[19,1],[17,23]]) {
 for(const channels of [1,2,3,4] as const) {
  for(const gray of [false,true]) it(`preserves statistics ${width}x${height}/${channels}/${gray}`,()=>{
   expect(stats(fixture(width!,height!,channels,gray))).toMatchSnapshot();
  });
 }
}
it("computes statistics without an image-sized luminance allocation",()=>{
 const image=fixture(257,129,4),Native=Uint8Array;
 vi.stubGlobal("Uint8Array",new Proxy(Native,{construct(target,args){
  if(typeof args[0]==="number" && args[0]>4096) throw new Error("unbounded statistics allocation");
  return Reflect.construct(target,args);
 }}));
 try {expect(stats(image).channels).toHaveLength(4);} finally {vi.unstubAllGlobals();}
});

import {computeStoredImageStats} from "./stats-storage.js";
import type {ImageByteStorage} from "../codecs/png-storage.js";

for(const [width,height] of [[1,1],[1,17],[19,1],[17,23],[40001,2]]) {
 for(const channels of [1,2,3,4] as const) it(`scans caller-backed statistics ${width}x${height}/${channels}`,async()=>{
  const image=fixture(width!,height!,channels),expected=stats(image);
  const position=2**32+17,borrowed=new Uint8Array(4096);
  let reads=0;
  const storage:ImageByteStorage={
   allocate(){throw new Error("statistics must not allocate backing");},
   async write(){throw new Error("statistics must not write backing");},
   async read(offset,length){
    expect(length).toBeLessThanOrEqual(4096);
    expect(offset).toBeGreaterThanOrEqual(position);
    borrowed.fill(0);borrowed.set(image.data.subarray(offset-position,offset-position+length));reads++;
    return borrowed.subarray(0,length);
   }
  };
  const Native=Uint8Array;
  vi.stubGlobal("Uint8Array",new Proxy(Native,{construct(target,args){
   if(typeof args[0]==="number" && args[0]>4096) throw new Error("unbounded statistics allocation");
   return Reflect.construct(target,args);
  }}));
  try {expect(await computeStoredImageStats({...image,position},storage,new AbortController().signal)).toEqual(expected);}
  finally {vi.unstubAllGlobals();}
  expect(reads).toBeGreaterThan(0);
 });
}
for(const failure of ["read","truncated","cancel"] as const) it(`propagates backing ${failure}`,async()=>{
 const image=fixture(257,129,4),controller=new AbortController(),error=new Error(failure);
 let reads=0;
 const storage:ImageByteStorage={allocate(){throw error;},async write(){throw error;},async read(offset,length){
  reads++;
  if(reads===2) {
   if(failure==="cancel") controller.abort(error);
   else if(failure==="read") throw error;
   else return new Uint8Array(length-1);
  }
  return image.data.subarray(offset,offset+length);
 }};
 await expect(computeStoredImageStats({...image,position:0},storage,controller.signal))
  .rejects[failure==="truncated"?"toThrow":"toBe"](failure==="truncated"?"Truncated image backing storage":error);
 expect(reads).toBe(2);
});
