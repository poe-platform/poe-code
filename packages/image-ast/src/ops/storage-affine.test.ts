import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import {affineImage,rotateImage} from "./transform.js";
import {isStoredImageOperation,transformStoredImage} from "./storage.js";
const operations:ImageAstNode[]=[...["nearest","bilinear","bicubic","nohalo"].flatMap(interpolator=>[255,73,0].map(alpha=>({kind:"affine" as const,matrix:[1.2,0.3,-0.4,0.8] as const,interpolator,background:{r:27,g:83,b:151,a:alpha},idx:0.4,idy:-0.2,odx:1.2,ody:-0.7}))),...[-23,0.0000001,89.9999999,90,135,180,270,360].map(angle=>({kind:"rotate" as const,angle,background:{r:21,g:44,b:98,a:71}}))];
it.each(operations.map((operation,index)=>({operation,index})))("backs affine/rotation $index",async({operation})=>{
 const width=19,height=13,data=Uint8Array.from({length:width*height*4},(_,i)=>(i*43+Math.floor(i/7))%256);
 const image:RgbaImage={width,height,data,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true};
 const expected=operation.kind==="affine"?affineImage(image,operation):rotateImage(image,(operation as Extract<ImageAstNode,{kind:"rotate"}>).angle,(operation as Extract<ImageAstNode,{kind:"rotate"}>).background),memory=new Uint8Array(100_000);memory.set(data,8);let end=data.length+8;
 const storage={allocate(length:number){const position=end;end+=length;return position;},read:vi.fn(async(position:number,length:number)=>memory.subarray(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
 const {data:ignored,...metadata}=image;
 expect(isStoredImageOperation(operation)).toBe(true);
 const actual=await transformStoredImage({...metadata,position:8},storage,operation as Parameters<typeof transformStoredImage>[2],new AbortController().signal);
 const {data:ignoredExpected,...expectedMetadata}=expected;
 expect(actual).toEqual({...expectedMetadata,position:actual.position});
 expect(Buffer.compare(memory.subarray(actual.position,actual.position+expected.data.length),expected.data)).toBe(0);
 expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
 expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
