import {expect,it,vi} from "vitest";
import {transformStoredImage} from "./storage.js";
import {extendImage,medianImage,trimImage} from "./transform.js";
import type {ImageAstNode,RgbaImage} from "../ast.js";
const operations:ImageAstNode[]=[...["background","copy","repeat","mirror"].map(extendWith=>({kind:"extend" as const,top:7,bottom:3,left:9,right:5,background:{r:31,g:73,b:19,a:128},extendWith:extendWith as "copy"})),...[1,3,7].map(size=>({kind:"median" as const,size})),{kind:"trim",threshold:10},{kind:"trim",threshold:10,lineArt:true}];
it.each(operations)("applies $kind through bounded backing %j",async operation=>{
  const width=17,height=13,data=Uint8Array.from({length:width*height*4},(_,i)=>{const p=Math.floor(i/4),x=p%width,y=Math.floor(p/width);return x<3||x>13||y<3||y>9?255:(i*43+Math.floor(i/7))%256;});
  const image:RgbaImage={width,height,data,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true};
  const expected=operation.kind==="extend"?extendImage(image,operation):operation.kind==="median"?medianImage(image,operation.size):trimImage(image,operation as Extract<ImageAstNode,{kind:"trim"}>);
  const memory=new Uint8Array(100_000);memory.set(data,8);let end=data.length+8;
  const storage={allocate(length:number){const position=end;end+=length;return position;},read:vi.fn(async(position:number,length:number)=>memory.subarray(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  const actual=await transformStoredImage({...metadata,position:8},storage,operation as Parameters<typeof transformStoredImage>[2],new AbortController().signal);
  const {data:ignoredExpected,...expectedMetadata}=expected;
  expect(actual).toEqual({...expectedMetadata,position:actual.position});
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+actual.width*actual.height*4),expected.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
