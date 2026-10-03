import {expect,it,vi} from "vitest";
import type {RgbaImage} from "../ast.js";
import {claheImage} from "./transform.js";
import {isStoredImageOperation,transformStoredImage} from "./storage.js";
it.each([1,2,3,4].flatMap(channels=>[0,1,3,8].flatMap(maxSlope=>[1,4,23].map(window=>({channels,maxSlope,window})))))("CLAHE channels=$channels slope=$maxSlope window=$window",async({channels,maxSlope,window})=>{
 const width=19,height=13,data=Uint8Array.from({length:width*height*4},(_,i)=>(i*43+Math.floor(i/7))%256);
 const image:RgbaImage={width,height,data,format:"png",space:channels<=2?"b-w":"srgb",channels,depth:"uchar",density:72,hasAlpha:channels%2===0};
 const operation={kind:"clahe" as const,width:window,height:window+1,maxSlope},expected=claheImage(image,operation),memory=new Uint8Array(100_000);memory.set(data,8);let end=data.length+8;
 const storage={allocate(length:number){const position=end;end+=length;return position;},read:vi.fn(async(position:number,length:number)=>memory.subarray(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
 const {data:ignored,...metadata}=image;
 expect(isStoredImageOperation(operation)).toBe(true);
 const actual=await transformStoredImage({...metadata,position:8},storage,operation as Parameters<typeof transformStoredImage>[2],new AbortController().signal);
 expect(actual).toEqual({...metadata,position:actual.position});
 expect(Buffer.compare(memory.subarray(actual.position,actual.position+data.length),expected.data)).toBe(0);
 expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
 expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
