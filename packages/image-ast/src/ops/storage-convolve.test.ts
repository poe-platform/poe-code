import {expect,it,vi} from "vitest";
import type {RgbaImage} from "../ast.js";
import {convolveImage} from "./transform.js";
import {transformStoredImage} from "./storage.js";
it.each([false,true].flatMap(alpha=>[false,true].flatMap(premultiplied=>[0,3,-2].map(scale=>({alpha,premultiplied,scale})))))("convolves alpha=$alpha premultiplied=$premultiplied scale=$scale",async({alpha,premultiplied,scale})=>{
 const width=19,height=13,data=Uint8Array.from({length:width*height*4},(_,i)=>i%4===3&&!alpha?255:(i*43+Math.floor(i/7))%256);
 const image:RgbaImage={width,height,data,format:"png",space:"srgb",channels:alpha?4:3,depth:"uchar",density:72,hasAlpha:alpha,isPremultiplied:premultiplied};
 const operation={kind:"convolve" as const,width:3,height:3,kernel:[1,2,-1,0,3,0,-1,2,1],scale,offset:17};
 const expected=convolveImage(image,operation),memory=new Uint8Array(100_000);memory.set(data,8);let end=data.length+8;
 const storage={allocate(length:number){const position=end;end+=length;return position;},read:vi.fn(async(position:number,length:number)=>memory.subarray(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
 const {data:ignored,...metadata}=image;
 const actual=await transformStoredImage({...metadata,position:8},storage,operation as Parameters<typeof transformStoredImage>[2],new AbortController().signal);
 expect(actual).toEqual({...metadata,position:actual.position});
 expect(Buffer.compare(memory.subarray(actual.position,actual.position+data.length),expected.data)).toBe(0);
 expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
});
