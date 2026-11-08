import {expect,it} from "vitest";
import {decodeImage,encodeImage} from "./portable.js";
import {encodeStoredImage,isStoredOutputFormat} from "./image-encode.js";
import type {ImageByteStorage,StoredRgbaImage} from "./codecs/png-storage.js";

it.each(["srgb", "b-w"] as const)("encodes %s PDF pixels and transparency through bounded borrowed storage",async(space)=>{
 const width=113,height=97,data=Uint8Array.from({length:width*height*4},(_,i)=>(i*37)%256);
 const image={width,height,format:"png" as const,space,channels:4 as const,depth:"uchar" as const,hasAlpha:true};
 const loan=new Uint8Array(4096);let largest=0;
 const storage:ImageByteStorage={allocate(){throw new Error("unexpected allocation");},async write(){throw new Error("unexpected write");},async read(position,length){largest=Math.max(largest,length);expect(length).toBeLessThanOrEqual(loan.length);loan.fill(0);loan.set(data.subarray(position,position+length));return loan.subarray(0,length);}};
 expect(isStoredOutputFormat("pdf")).toBe(true);
 const chunks:Uint8Array[]=[];
 const stream=encodeStoredImage({...image,position:0},storage,new AbortController().signal,{format:"pdf"});
 let step=await stream.next();while(!step.done){const chunk=step.value;expect(chunk.length).toBeLessThanOrEqual(16384);chunks.push(chunk.slice());step=await stream.next();}
 expect(step.value).toMatchObject({format:"pdf",width,height,channels:encodeImage({...image,data},{format:"pdf"}).channels});
 const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const expected=decodeImage(encodeImage({...image,data},{format:"pdf"}).data),actual=decodeImage(bytes);
 expect(actual.width).toBe(width);expect(actual.height).toBe(height);expect(actual.data.length).toBe(expected.data.length);expect(actual.data.every((value,index)=>value===expected.data[index])).toBe(true);expect(largest).toBeGreaterThan(0);
});

it("preserves cancellation and storage error identity during PDF encoding",async()=>{
 const image:StoredRgbaImage={width:20,height:20,position:0,format:"png",space:"srgb",channels:4,depth:"uchar",hasAlpha:true};
 for(const abort of [false,true]){
  const controller=new AbortController(),failure=new Error("PDF input unavailable");
  const storage:ImageByteStorage={allocate(){throw failure;},async write(){throw failure;},async read(){if(abort)controller.abort(failure);throw failure;}};
  await expect((async()=>{for await(const chunk of encodeStoredImage(image,storage,controller.signal,{format:"pdf"}))void chunk;})()).rejects.toBe(failure);
 }
});
