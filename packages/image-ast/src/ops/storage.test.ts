import {expect, it, vi} from "vitest";
import type {RgbaImage} from "../ast.js";
import {transformStoredImage, type StoredImageOperation} from "./storage.js";
import {flipImage, flopImage, rotateImage, extractImage, applyExifOrientation} from "./transform.js";

const background={r:0,g:0,b:0,a:255};
const operations: StoredImageOperation[] = [{kind:"flip"},{kind:"flop"},...[0,90,180,270,-90,450].map(angle=>({kind:"rotate" as const,angle,background})),{kind:"extract",left:2,top:3,width:34,height:35},...[1,2,3,4,5,6,7,8].map(()=>({kind:"autoOrient" as const}))];
it.each(operations.map((operation,index)=>({operation,index})))("matches spatial pixel semantics across storage tiles: $index", async ({operation,index}) => {
  const width=67,height=39;
  const data=Uint8Array.from({length:width*height*4},(_,i)=>(i*17+Math.floor(i/width))%256);
  const image:RgbaImage={width,height,data,format:"png",space:"srgb",channels:4,depth:"uchar",density:144,hasAlpha:true,orientation:Math.max(1,index-8)};
  const memory=new Uint8Array(data.length*12+8);memory.set(data,8);
  let end=data.length+8;
  const storage={allocate(length:number){const position=end;end+=length;return position;},read:vi.fn(async(position:number,length:number)=>memory.slice(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
  const expected=operation.kind==="flip"?flipImage(image):operation.kind==="flop"?flopImage(image):operation.kind==="rotate"?rotateImage(image,operation.angle,operation.background):operation.kind==="extract"?extractImage(image,operation):applyExifOrientation(image);
  const {data:ignoredData,...metadata}=image;
  const actual=await transformStoredImage({...metadata,position:8},storage,operation,new AbortController().signal);
  expect({...actual,position:undefined,data:undefined}).toEqual({...expected,position:undefined,data:undefined});
  expect(memory.slice(actual.position,actual.position+actual.width*actual.height*4)).toEqual(expected.data);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
