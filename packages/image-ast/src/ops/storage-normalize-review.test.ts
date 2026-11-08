import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {FileDescriptor,FileSystem} from "@poe-code/safe-fs/contracts";
import type {RgbaImage} from "../ast.js";
import sharp from "../index.js";
import {normalizeImage} from "./transform.js";
import {normalizeStoredImage} from "./storage-normalize.js";

// Recorded from the Float32-plane implementation at 527ab313ee, before this refactor.
const vectors=[
{kind:"mixed",options:{},hash:"7e30568b6c314b970ccb53ff14c258612c031edfdd9648a450b6af70a17ee8d6"},
{kind:"mixed",options:{lower:0,upper:100},hash:"f5a8bc20d609b8868b52ffc997797fc4a33e0603740b3db9a469c9f69975995b"},
{kind:"mixed",options:{lower:49.9,upper:50.1},hash:"b091cb15ffce6aeca42c22202a6f7ec403e3a00afa33002d63fa67b6c1062892"},
{kind:"mixed",options:{lower:-20,upper:120},hash:"f5a8bc20d609b8868b52ffc997797fc4a33e0603740b3db9a469c9f69975995b"},
{kind:"mixed",options:{lower:90,upper:10},hash:"b091cb15ffce6aeca42c22202a6f7ec403e3a00afa33002d63fa67b6c1062892"},
{kind:"ramp",options:{lower:0.99,upper:99.01},hash:"763aca0785cba8a99b1128943ad53307fe3d46c42e9d9eed650cb35e90194f61"},
{kind:"ramp",options:{lower:1,upper:99},hash:"3d491247ff4f53dd063c21377136f44c45477e8e3d92bebe6704833b8a4b61e9"},
{kind:"flat",options:{},hash:"bdff8050068ac8400773047624ca3074e5bd5e36db626bb42045f62a2511807c"},
{kind:"nearflat",options:{lower:0,upper:100},hash:"50405a5e21bde4f6c17e6495f2b8f391a2e99a21eb4f31b6135f183cdff415fb"},
{kind:"single",options:{},hash:"90e0701c85ad13441c598364924097800c5eeddf4aec33505ee48972e17f97d9"}
];
function fixture(kind="mixed") {
  const count=kind==="single"?1:4099;
  const data=Uint8Array.from({length:count*4},(_,i)=>i%4===3?(i*13)%256:kind==="flat"?128:kind==="nearflat"?128+Math.floor(i/4)%2:kind==="single"?31:kind==="ramp"?Math.floor(i/4)%256:(i*43+Math.floor(i/257)*17)%256);
  const image:RgbaImage={width:count,height:1,data,format:"png",space:kind==="mixed"?"srgb":"b-w",channels:kind==="mixed"?4:2,hasAlpha:true,depth:"uchar",density:144,orientation:6};
  const memory=new Uint8Array(data.length*2+8);memory.set(data,8);
  const borrowed=new Uint8Array(4096);
  const storage={allocate:vi.fn(()=>data.length+8),read:vi.fn(async(position:number,length:number)=>{borrowed.fill(113);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},memory,storage,chunks:Math.ceil(data.length/4096)};
}
it.each(vectors)("preserves committed Float32 and percentile bytes: $kind $options",async({kind,options,hash})=>{
  const {image,stored,memory,storage,chunks}=fixture(kind);
  const buffered=normalizeImage(image,options),actual=await normalizeStoredImage(stored,storage,options,new AbortController().signal);
  const result=memory.subarray(actual.position,actual.position+image.data.length);
  expect(createHash("sha256").update(buffered.data).digest("hex")).toBe(hash);
  expect(createHash("sha256").update(result).digest("hex")).toBe(hash);
  expect({...actual,position:undefined}).toEqual({...buffered,data:undefined});
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(result.every((value,index)=>index%4!==3 || value===image.data[index])).toBe(true);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
  expect(storage.read).toHaveBeenCalledTimes(chunks*(actual.position===stored.position?1:2));
  if(actual.position===stored.position)expect(storage.allocate).not.toHaveBeenCalled();
});
it.each(["before","histogram","output","write"])("honors cancellation during %s without further work",async phase=>{
  const {stored,storage,chunks}=fixture(),controller=new AbortController(),reason={phase};
  let reads=0;
  const read=storage.read.getMockImplementation()!;
  if(phase==="before")controller.abort(reason);
  storage.read.mockImplementation(async(position,length)=>{reads++;const bytes=await read(position,length);if(reads===(phase==="histogram"?1:phase==="output"?chunks+1:-1))controller.abort(reason);return bytes;});
  if(phase==="write")storage.write.mockImplementationOnce(async()=>{controller.abort(reason);});
  await expect(normalizeStoredImage(stored,storage,{},controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(phase==="before"?0:phase==="histogram"?1:chunks+1);
  expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
  expect(storage.allocate).toHaveBeenCalledTimes(phase==="before" || phase==="histogram"?0:1);
});
it.each(["histogram","output"])("rejects truncated %s reads",async phase=>{
  const {stored,storage,chunks}=fixture();let reads=0;const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>++reads===(phase==="histogram"?1:chunks+1)?new Uint8Array(length-1):read(position,length));
  await expect(normalizeStoredImage(stored,storage,{},new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.write).not.toHaveBeenCalled();
});
it("propagates output write failure without starting another chunk",async()=>{
  const {stored,storage,chunks}=fixture(),reason=new Error("write failed");storage.write.mockRejectedValueOnce(reason);
  await expect(normalizeStoredImage(stored,storage,{},new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(chunks+1);expect(storage.write).toHaveBeenCalledTimes(1);
});
it("preserves output and closes scratch handles when normalization backing fails",async()=>{
  const fs=new MemoryFileSystem(),reason=new Error("normalization read failed");let sourceClosed=false,opened=0,closed=0;
  const data=Uint8Array.from({length:513*513*4},(_,i)=>(i*43+Math.floor(i/257)*17)%256);
  await fs.writeFile("/in.png",await sharp(data,{raw:{width:513,height:513,channels:4}}).png().toBuffer());await fs.writeFile("/out.png",Uint8Array.of(42));
  const overrides:Partial<FileSystem>={openReadFile:async(...args)=>{const handle=await fs.openReadFile(...args);return {...handle,close:async()=>{sourceClosed=true;await handle.close();}};},open:async(...args)=>{
    const descriptor=await fs.open(...args);opened++;
    const methods:Partial<FileDescriptor>={read:async(...readArgs)=>{if(sourceClosed)throw reason;return descriptor.read(...readArgs);},close:async()=>{closed++;await descriptor.close();}};
    return new Proxy(descriptor,{get(target,key){if(Object.hasOwn(methods,key))return Reflect.get(methods,key);const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  }};
  const filesystem=new Proxy(fs,{get(target,key){if(Object.hasOwn(overrides,key))return Reflect.get(overrides,key);if(key==="readFile" || key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  await expect(sharp("/in.png",{filesystem}).normalize().png().toFile("/out.png")).rejects.toBe(reason);
  expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);expect(sourceClosed).toBe(true);
  expect(await fs.readFile("/out.png")).toEqual(Uint8Array.of(42));
  expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});
