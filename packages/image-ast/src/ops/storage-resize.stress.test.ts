import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {RgbaImage} from "../ast.js";
import type {ResizeSpec} from "./resize-math.js";
import {resizeImage} from "./resize.js";
import {resizeStoredImage} from "./storage-resize.js";
import {transformStoredImage} from "./storage.js";
import {flipImage,rotateImage} from "./transform.js";

type Vector=Partial<ResizeSpec>&{name:string;alpha?:boolean;gray?:boolean;premultiplied?:boolean;pages?:number;expected:Omit<RgbaImage,"data">;hash:string};
// Recorded by executing resize.ts and resize-math.ts at committed 506bf275a1.
const vectors:Vector[]=[
{"name":"null","width":null,"height":null,"expected":{"width":31,"height":23,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"ccca9a7a1aabe6deb18695782140b7854cb1e5e40897b93556b3307493798beb"},
{"name":"width","width":11,"height":null,"expected":{"width":11,"height":8,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"3caeca06b07fdede6caac524c0ef46ec29e09416e54c379c048706409e14f854"},
{"name":"height","width":null,"height":17,"expected":{"width":23,"height":17,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"2d60f2c57732a94e0f603f5d85f3574d2fc516d0c98ecbdccaa406838561509a"},
{"name":"fill-width","width":11,"height":null,"fit":"fill","expected":{"width":11,"height":23,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"dd77f7c31295575bf0d799baef55cee55b3ff44a273f7f523f46bcaae9ba9e3f"},
{"name":"no-enlarge","width":73,"height":51,"withoutEnlargement":true,"expected":{"width":31,"height":23,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"ccca9a7a1aabe6deb18695782140b7854cb1e5e40897b93556b3307493798beb"},
{"name":"no-reduce","width":11,"height":7,"withoutReduction":true,"expected":{"width":31,"height":23,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"ccca9a7a1aabe6deb18695782140b7854cb1e5e40897b93556b3307493798beb"},
{"name":"both","width":73,"height":7,"withoutEnlargement":true,"withoutReduction":true,"expected":{"width":31,"height":23,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"ccca9a7a1aabe6deb18695782140b7854cb1e5e40897b93556b3307493798beb"},
{"name":"entropy","position":"entropy","alpha":true,"expected":{"width":13,"height":17,"format":"png","space":"srgb","channels":4,"hasAlpha":true,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"0e15e6ed6dfcc14e159b5b4a598bff0fafdd7d6e823b282dff84a761f873e62d"},
{"name":"attention","position":"attention","alpha":true,"expected":{"width":13,"height":17,"format":"png","space":"srgb","channels":4,"hasAlpha":true,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"dd00bba4e0d982975d58aadd08a7202c82402644565065493262c9b36352220a"},
{"name":"gray-entropy","position":16,"gray":true,"expected":{"width":13,"height":17,"format":"png","space":"b-w","channels":1,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"ebadf4fad50535c60b36134b1afd3c4d6bde41be26c81fbe847106bcad4f03f3"},
{"name":"gray-attention","position":17,"gray":true,"expected":{"width":13,"height":17,"format":"png","space":"b-w","channels":1,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"eceb11a23b1202802a4871ce66536a2eecc9ad4cab895f1cfe08a75476897185"},
{"name":"premultiplied","fit":"contain","alpha":true,"premultiplied":true,"expected":{"width":13,"height":17,"format":"png","space":"srgb","channels":4,"hasAlpha":true,"depth":"uchar","density":144,"isPremultiplied":true},"hash":"6aad090eaac573bbf7c683cee9a662d55703ce1c2ca1f1e1c44655819921db78"},
{"name":"multipage","pages":3,"fit":"contain","alpha":true,"expected":{"width":13,"height":51,"format":"png","space":"srgb","channels":4,"hasAlpha":true,"depth":"uchar","density":144,"isPremultiplied":false,"pages":3,"pageHeight":17},"hash":"b6481169493f9e2f37a876721431cff02a695f0854527c8ce8e45624a947df2d"},
{"name":"contain-no-padding","width":31,"height":23,"fit":"contain","expected":{"width":31,"height":23,"format":"png","space":"srgb","channels":4,"hasAlpha":true,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"ccca9a7a1aabe6deb18695782140b7854cb1e5e40897b93556b3307493798beb"},
{"name":"numeric-gravity","position":8,"fit":"contain","expected":{"width":13,"height":17,"format":"png","space":"srgb","channels":4,"hasAlpha":true,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"5379afed908b2d6d932cf1ff1747f876ee4a95b46df421248ab136299fd596e3"},
{"name":"inside","width":73,"height":51,"fit":"inside","expected":{"width":69,"height":51,"format":"png","space":"srgb","channels":3,"hasAlpha":false,"depth":"uchar","density":144,"isPremultiplied":false},"hash":"6a404c24f4e48fa8e5d33882bc5bf0fbcc416e414694211fe1dddd859f4afb59"}
];
function fixture(vector:Partial<Vector>={}) {
  const width=31,height=23*(vector.pages??1),data=Uint8Array.from({length:width*height*4},(_,i)=>i%4===3&&!vector.alpha?255:(i*43+Math.floor(i/7))%256);
  if(vector.gray)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const image:RgbaImage={width,height,data,format:"png",space:vector.gray?"b-w":"srgb",channels:vector.gray?(vector.alpha?2:1):(vector.alpha?4:3),hasAlpha:!!vector.alpha,depth:"uchar",density:144,isPremultiplied:!!vector.premultiplied,...(vector.pages?{pages:vector.pages,pageHeight:23}:{})};
  const spec:ResizeSpec={width:13,height:17,fit:"cover",position:"center",kernel:"lanczos3",background:{r:17,g:39,b:79,a:128},withoutEnlargement:false,withoutReduction:false,...vector};
  const memory=new Uint8Array(1_000_000),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const result=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return result;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||position+length>end||length>4096)throw new Error("invalid backing read");borrowed.fill(83);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,spec,stored:{...metadata,position:8},memory,storage};
}
it.each(vectors)("preserves committed $name geometry, metadata and pixels",async vector=>{
  const {image,spec,stored,storage,memory}=fixture(vector),expected=resizeImage(image,spec);
  const actual=await resizeStoredImage(stored,storage,spec,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual(vector.expected);
  expect({...expected,data:undefined}).toEqual(vector.expected);
  expect(createHash("sha256").update(expected.data).digest("hex")).toBe(vector.hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+actual.width*actual.height*4)).digest("hex")).toBe(vector.hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
it.each(["cover","contain"] as const)("applies post-scale flip and rotation before %s crop or embedding",async fit=>{
  const {image,spec,stored,storage,memory}=fixture({fit,alpha:true});
  const expected=resizeImage(image,spec,scaled=>rotateImage(flipImage(scaled),90));
  const signal=new AbortController().signal;
  const actual=await resizeStoredImage(stored,storage,spec,signal,async scaled=>transformStoredImage(await transformStoredImage(scaled,storage,{kind:"flip"},signal),storage,{kind:"rotate",angle:90,background:{r:0,g:0,b:0,a:255}},signal));
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+actual.width*actual.height*4),expected.data)).toBe(0);
});
it.each(["entropy","attention"] as const)("honors cancellation at the first %s crop read after resampling",async position=>{
  const {stored,spec,storage}=fixture({position}),controller=new AbortController(),reason={position};let resampled=false,readsAtAbort=0;
  const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(offset,length)=>{const bytes=await read(offset,length);if(resampled){readsAtAbort=storage.read.mock.calls.length;controller.abort(reason);}return bytes;});
  await expect(resizeStoredImage(stored,storage,spec,controller.signal,async image=>{resampled=true;return image;})).rejects.toBe(reason);
  expect(readsAtAbort).toBeGreaterThan(0);expect(storage.read).toHaveBeenCalledTimes(readsAtAbort);
});
it("rejects an invalid crop allocation without publishing bytes",async()=>{
  const {stored,spec,storage}=fixture({width:31,height:7});
  storage.allocate.mockReturnValueOnce(-1);
  await expect(resizeStoredImage(stored,storage,spec,new AbortController().signal)).rejects.toThrow("Invalid image backing allocation");
  expect(storage.write).not.toHaveBeenCalled();
});
it("does no I/O after pre-cancellation even when both dimensions are omitted",async()=>{
  const {stored,spec,storage}=fixture({width:null,height:null}),controller=new AbortController(),reason={cancel:true};controller.abort(reason);
  await expect(resizeStoredImage(stored,storage,spec,controller.signal)).rejects.toBe(reason);
  expect(storage.read).not.toHaveBeenCalled();expect(storage.allocate).not.toHaveBeenCalled();
});
it("rejects a short retained crop read",async()=>{
  const {stored,spec,storage}=fixture({width:31,height:7});storage.read.mockResolvedValueOnce(new Uint8Array(123));
  await expect(resizeStoredImage(stored,storage,spec,new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.write).not.toHaveBeenCalled();
});
it("does not process further pages after the first page copy fails",async()=>{
  const {stored,spec,storage}=fixture({pages:3,width:null,height:null}),reason=new Error("page copy failed");storage.write.mockRejectedValueOnce(reason);
  await expect(resizeStoredImage(stored,storage,spec,new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(1);expect(storage.write).toHaveBeenCalledTimes(1);
});
it("preserves cancellation delivered by the post-scale callback on an exact fit",async()=>{
  const {stored,spec,storage}=fixture({width:31,height:23,fit:"fill"}),controller=new AbortController(),reason={cancel:"post-scale"};
  await expect(resizeStoredImage(stored,storage,spec,controller.signal,async image=>{controller.abort(reason);return image;})).rejects.toBe(reason);
  expect(storage.write).not.toHaveBeenCalled();
});
it("stops containment writes immediately when the backend cancels",async()=>{
  const {stored,spec,storage}=fixture({width:37,height:37,fit:"contain",withoutEnlargement:true}),controller=new AbortController(),reason={cancel:"embedding"};let reads=0;
  storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;controller.abort(reason);});
  await expect(resizeStoredImage(stored,storage,spec,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(1);
});
