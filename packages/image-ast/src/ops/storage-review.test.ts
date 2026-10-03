import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {FileSystem, FileDescriptor} from "@poe-code/safe-fs/contracts";
import type {RgbaImage} from "../ast.js";
import type {StoredRgbaImage} from "../codecs/png-storage.js";
import sharp from "../index.js";
import {transformStoredImage, type StoredImageOperation} from "./storage.js";
import {applyExifOrientation, extractImage, flipImage, flopImage, rotateImage} from "./transform.js";

function fixture(metadata: Partial<RgbaImage> = {}) {
  const width=65,height=71;
  const image: RgbaImage={width,height,data:Uint8Array.from({length:width*height*4},(_,i)=>(i*17+Math.floor(i/13))%256),format:"png",space:"srgb",channels:4,depth:"uchar",hasAlpha:true,...metadata};
  const memory=new Uint8Array(image.data.length*6+8);memory.set(image.data,8);
  let end=image.data.length+8;
  const borrowed=new Uint8Array(4096);
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;return position;}),read:vi.fn(async(position:number,length:number)=>{borrowed.fill(0xee);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
  const {data:ignored,...rest}=image;
  const stored:StoredRgbaImage={...rest,position:8};
  return {image,stored,storage,memory};
}

it.each([1,2,3,4,5,6,7,8,0,9,NaN,5.5])("matches orientation %s across tile edges with borrowed reads", async orientation=>{
  const {image,stored,storage,memory}=fixture({orientation});
  const expected=applyExifOrientation(image);
  const actual=await transformStoredImage(stored,storage,{kind:"autoOrient"},new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(memory.slice(actual.position,actual.position+actual.width*actual.height*4)).toEqual(expected.data);
  expect(memory.slice(8,8+image.data.length)).toEqual(image.data);
});

it.each([{width:0},{height:-1},{width:1.5},{width:Infinity},{height:NaN},{width:Number.MAX_SAFE_INTEGER},{position:-1},{position:0.5}])("rejects invalid backing geometry %j before allocation",async invalid=>{
  const {stored,storage}=fixture();
  await expect(transformStoredImage({...stored,...invalid},storage,{kind:"flip"},new AbortController().signal)).rejects.toThrow("Invalid stored image dimensions");
  expect(storage.allocate).not.toHaveBeenCalled();
  expect(storage.read).not.toHaveBeenCalled();
});

it.each([{left:-1,top:0,width:2,height:2},{left:64,top:0,width:2,height:2},{left:0,top:70,width:2,height:2},{left:0,top:0,width:0,height:2},{left:NaN,top:0,width:2,height:2},{left:0,top:Infinity,width:2,height:2}])("rejects invalid crop %j before allocation",async region=>{
  const {stored,storage}=fixture();
  await expect(transformStoredImage(stored,storage,{kind:"extract",...region},new AbortController().signal)).rejects.toThrow("extract_area");
  expect(storage.allocate).not.toHaveBeenCalled();
});

it.each(["before", "read", "write"])("honors cancellation %s without further storage work",async phase=>{
  const {stored,storage}=fixture();
  const controller=new AbortController(),reason={phase};
  if(phase==="before") controller.abort(reason);
  if(phase==="read") storage.read.mockImplementationOnce(async(_position,length)=>{controller.abort(reason);return new Uint8Array(length);});
  if(phase==="write") storage.write.mockImplementationOnce(async()=>{controller.abort(reason);});
  await expect(transformStoredImage(stored,storage,{kind:"flip"},controller.signal)).rejects.toBe(reason);
  expect(storage.allocate).toHaveBeenCalledTimes(phase==="before"?0:1);
  expect(storage.read).toHaveBeenCalledTimes(phase==="before"?0:phase==="read"?1:32);
  expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
});

it("rejects truncated storage reads without writing a partial tile",async()=>{
  const {stored,storage}=fixture();
  storage.read.mockImplementationOnce(async(_position,length)=>new Uint8Array(length-1));
  await expect(transformStoredImage(stored,storage,{kind:"flip"},new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.write).not.toHaveBeenCalled();
});

const multiOperations:StoredImageOperation[]=[{kind:"extract",left:1,top:2,width:33,height:33},{kind:"extract",left:1,top:36,width:33,height:38},{kind:"flip"},{kind:"flop"},{kind:"rotate",angle:180,background:{r:0,g:0,b:0,a:255}},{kind:"autoOrient"}];
it.each(multiOperations)("preserves multi-page $kind pixel and metadata semantics",async operation=>{
  const {image,stored,storage,memory}=fixture({width:65,height:111,pages:3,pageHeight:37,orientation:6,data:Uint8Array.from({length:65*111*4},(_,i)=>i*31%256)});
  const expected=operation.kind==="extract"?extractImage(image,operation):operation.kind==="flip"?flipImage(image):operation.kind==="flop"?flopImage(image):operation.kind==="rotate"?rotateImage(image,operation.angle):applyExifOrientation(image);
  const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(memory.slice(actual.position,actual.position+actual.width*actual.height*4)).toEqual(expected.data);
});
it.each([90,270])("rejects multi-page rotation %i before allocation",async angle=>{
  const {stored,storage}=fixture({height:111,pages:3,pageHeight:37});
  await expect(transformStoredImage(stored,storage,{kind:"rotate",angle,background:{r:0,g:0,b:0,a:255}},new AbortController().signal)).rejects.toThrow("multi-page");
  expect(storage.allocate).not.toHaveBeenCalled();
});

it.each(["cancel", "io", "geometry"])("cleans spilled storage and preserves output after chained transform %s failure",async failure=>{
  const fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error("injected transform failure");
  const bytes=await sharp({create:{width:513,height:513,channels:4,background:"red"}}).png().toBuffer();
  await fs.writeFile("/input.png",bytes);await fs.writeFile("/output.png",Uint8Array.of(42));
  let sourceClosed=false,opened=0,closed=0,injected=false;
  const overrides:Partial<FileSystem>={
    openReadFile:async(...args)=>{const handle=await fs.openReadFile(...args);return {...handle,close:async()=>{sourceClosed=true;await handle.close();}};},
    open:async(...args)=>{const descriptor=await fs.open(...args);opened++;const methods:Partial<FileDescriptor>={write:async(...writeArgs)=>{
      if(sourceClosed && !injected && failure!=="geometry") {injected=true;if(failure==="cancel")controller.abort(reason);else throw reason;}
      return descriptor.write(...writeArgs);
    },close:async()=>{closed++;await descriptor.close();}};return new Proxy(descriptor,{get(target,key){if(Object.hasOwn(methods,key))return Reflect.get(methods,key);const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});}
  };
  const filesystem=new Proxy(fs,{get(target,key){if(Object.hasOwn(overrides,key))return Reflect.get(overrides,key);if(key==="readFile" || key==="writeFile")return async()=>{throw new Error("whole-file fallback forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const operation=sharp("/input.png",{filesystem,signal:controller.signal}).flip().flop();
  if(failure==="geometry")operation.extract({left:512,top:0,width:2,height:2});
  if(failure==="geometry")await expect(operation.png().toFile("/output.png")).rejects.toThrow("extract_area");
  else await expect(operation.png().toFile("/output.png")).rejects.toBe(reason);
  expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);expect(sourceClosed).toBe(true);
  expect(await fs.readFile("/output.png")).toEqual(Uint8Array.of(42));
  expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["input.png","output.png"]);
});
