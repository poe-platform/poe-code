import {expect,it,vi} from "vitest";
import type {RgbaImage} from "../ast.js";
import {dilateImage,erodeImage} from "./transform.js";
import {transformStoredImage} from "./storage.js";
it.each(["dilate","erode"].flatMap(kind=>[false,true].flatMap(alpha=>[1,3,17].map(width=>({kind:kind as "dilate"|"erode",alpha,width})))))("applies $kind radius=$width alpha=$alpha",async({kind,alpha,width})=>{
 const w=19,h=13,data=Uint8Array.from({length:w*h*4},(_,i)=>i%4===3&&!alpha?255:(i*43+Math.floor(i/7))%256);
 const image:RgbaImage={width:w,height:h,data,format:"png",space:"srgb",channels:alpha?4:3,depth:"uchar",density:72,hasAlpha:alpha};
 const expected=(kind==="dilate"?dilateImage:erodeImage)(image,width),memory=new Uint8Array(100_000);memory.set(data,8);let end=data.length+8;
 const storage={allocate(length:number){const position=end;end+=length;return position;},read:vi.fn(async(position:number,length:number)=>memory.subarray(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
 const {data:ignored,...metadata}=image;
 const actual=await transformStoredImage({...metadata,position:8},storage,{kind,width} as Parameters<typeof transformStoredImage>[2],new AbortController().signal);
 const {data:ignoredExpected,...expectedMetadata}=expected;
 expect(actual).toEqual({...expectedMetadata,position:actual.position});
 expect(Buffer.compare(memory.subarray(actual.position,actual.position+data.length),expected.data)).toBe(0);
 expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
});
