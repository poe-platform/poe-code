import {expect,it,vi} from "vitest";
import type {RgbaImage} from "../ast.js";
import {dilateImage,erodeImage} from "./transform.js";
import {transformStoredImage} from "./storage.js";

type Profile=Pick<RgbaImage,"channels"|"hasAlpha"|"isPremultiplied">;
function fixture(profile:Profile={channels:4,hasAlpha:true},width=17,height=15) {
  const data=Uint8Array.from({length:width*height*4},(_,i)=>(i*43+Math.floor(i/7))%256);
  if(profile.channels<3)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const image:RgbaImage={width,height,data,format:"png",space:profile.channels<3?"b-w":"srgb",depth:"uchar",density:144,pages:3,pageHeight:height/3,...profile};
  const memory=new Uint8Array(data.length*3+8),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(83);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
const profiles:Profile[]=[{channels:1,hasAlpha:false},{channels:2,hasAlpha:true},{channels:3,hasAlpha:false},{channels:4,hasAlpha:false},{channels:4,hasAlpha:true,isPremultiplied:true}];
const cases=(["dilate","erode"] as const).flatMap(kind=>profiles.flatMap(profile=>[-2,1.5,4].map(width=>({kind,profile,width}))));
it.each(cases)("matches unchanged buffered $kind width=$width for $profile",async({kind,profile,width})=>{
  const {image,stored,storage,memory}=fixture(profile),expected=(kind==="dilate"?dilateImage:erodeImage)(image,width);
  const actual=await transformStoredImage(stored,storage,{kind,width},new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.allocate).toHaveBeenCalledTimes(2);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
it.each((["dilate","erode"] as const).flatMap(kind=>[Number.MAX_SAFE_INTEGER,1e100].map(width=>({kind,width}))))("clamps repeated edge samples for $kind at radius $width",async({kind,width})=>{
  const {image,stored,storage,memory}=fixture(),expected=(kind==="dilate"?dilateImage:erodeImage)(image,Math.max(image.width,image.height));
  const actual=await transformStoredImage(stored,storage,{kind,width},new AbortController().signal);
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
});
it.each([NaN,Infinity])("rejects nonfinite radius %s before allocation",async width=>{
  const {stored,storage}=fixture();
  await expect(transformStoredImage(stored,storage,{kind:"dilate",width},new AbortController().signal)).rejects.toThrow("Invalid morphology radius");
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it.each([1,2])("preserves cancellation during pass %i without subsequent storage work",async pass=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={pass};let reads=0,writes=0;
  const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>{const bytes=await read(position,length);if(storage.allocate.mock.calls.length===pass){reads=storage.read.mock.calls.length;writes=storage.write.mock.calls.length;controller.abort(reason);}return bytes;});
  await expect(transformStoredImage(stored,storage,{kind:"erode",width:3},controller.signal)).rejects.toBe(reason);
  expect(storage.allocate).toHaveBeenCalledTimes(pass);expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(writes);
});
it.each([1,2])("rejects truncated pass %i reads",async pass=>{
  const {stored,storage}=fixture();const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>storage.allocate.mock.calls.length===pass?new Uint8Array(length-1):read(position,length));
  await expect(transformStoredImage(stored,storage,{kind:"dilate",width:3},new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.allocate).toHaveBeenCalledTimes(pass);expect(storage.write).toHaveBeenCalledTimes(pass-1);
});
it("propagates a vertical-pass write failure without further I/O",async()=>{
  const {stored,storage}=fixture(),reason=new Error("vertical write failed");const write=storage.write.getMockImplementation()!;let reads=0;
  storage.write.mockImplementation(async(position,bytes)=>{if(storage.allocate.mock.calls.length===2){reads=storage.read.mock.calls.length;throw reason;}await write(position,bytes);});
  await expect(transformStoredImage(stored,storage,{kind:"dilate",width:3},new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(2);
});
it("does not allocate for a pre-aborted operation",async()=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={cancel:true};controller.abort(reason);
  await expect(transformStoredImage(stored,storage,{kind:"erode",width:1},controller.signal)).rejects.toBe(reason);
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it.each(["dilate","erode"] as const)("keeps %s intermediates bounded across borrowed cache pages",async kind=>{
  const {image,stored,storage,memory}=fixture({channels:2,hasAlpha:true},1031,36),expected=(kind==="dilate"?dilateImage:erodeImage)(image,1),Original=Uint8Array;
  vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.byteLength??0;if(length>4096)throw new Error("unbounded morphology bytes");return Reflect.construct(target,args);}}));
  try {
    const actual=await transformStoredImage(stored,storage,{kind,width:1},new AbortController().signal);
    expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
    expect(storage.read.mock.calls.length).toBeGreaterThan(32);
  } finally {vi.unstubAllGlobals();}
});
it("yields to timer cancellation while reducing a large non-saturating neighborhood",async()=>{
  const {image,stored,storage,memory}=fixture({channels:4,hasAlpha:true},257,3);image.data.fill(1);memory.set(image.data,8);
  const controller=new AbortController(),reason={cancel:"wide radius"},timer=setTimeout(()=>controller.abort(reason),0);
  try {await expect(transformStoredImage(stored,storage,{kind:"dilate",width:1e100},controller.signal)).rejects.toBe(reason);expect(storage.allocate).toHaveBeenCalledTimes(1);}
  finally {clearTimeout(timer);}
});
