import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageAstNode,RgbaImage} from "./ast.js";
import type {StoredRgbaImage} from "./codecs/png-storage.js";
import sharp from "./index.js";
import {transformStoredImage} from "./ops/storage.js";
import {booleanImage,joinChannelImage} from "./ops/transform.js";
import {readImageResource,UnsupportedStoredResource} from "./image-resources.js";
type Operation=Extract<ImageAstNode,{kind:"boolean"|"joinChannel"}>;
// Recorded by independently executing buffered channel operations at 557dee0d31.
const vectors:{kind:"boolean"|"joinChannel";op?:"and"|"or"|"eor";channels:number;extraChannels:number;count:number;expected:Omit<RgbaImage,"data">;hash:string}[]=[
{"kind":"boolean","op":"and","channels":1,"extraChannels":4,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"bc2f5a36740d1fd399cea443811dd6fbb9faddec628281ac327e471945cf0305"},
{"kind":"boolean","op":"and","channels":4,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"035620bf98f63aa96250e54e4a90db879f1ffbd3fba17110fbbbf0a1aa2a9049"},
{"kind":"boolean","op":"and","channels":2,"extraChannels":2,"count":1,"expected":{"width":67,"height":19,"channels":2,"format":"png","space":"b-w","depth":"uchar","density":144,"hasAlpha":true},"hash":"b8f0bfb27be325b501c4198c4357d7e1f9302ec5546587069881d6842eaa7e00"},
{"kind":"boolean","op":"or","channels":1,"extraChannels":4,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"c8678ef8ff859236dfe1acd6bb1b0ce7008ee08d19451d5da043825c434e55d9"},
{"kind":"boolean","op":"or","channels":4,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"22e5667bad52392f3ea9efba011835c8893679aee7ace3510acb102ebc8a8802"},
{"kind":"boolean","op":"or","channels":2,"extraChannels":2,"count":1,"expected":{"width":67,"height":19,"channels":2,"format":"png","space":"b-w","depth":"uchar","density":144,"hasAlpha":true},"hash":"19a27aaebb25416c4b923b7da46552b3af9c59a6e993123481c2501388fb2e4f"},
{"kind":"boolean","op":"eor","channels":1,"extraChannels":4,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"450476b74ce4b27b481e07ed6569d2e036969f2c8549f9b28ae020e45a888977"},
{"kind":"boolean","op":"eor","channels":4,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"be403bd75823cccd55eb72f9972e4e7d289c8f6dcf7784d9f303b5325ccb3fdc"},
{"kind":"boolean","op":"eor","channels":2,"extraChannels":2,"count":1,"expected":{"width":67,"height":19,"channels":2,"format":"png","space":"b-w","depth":"uchar","density":144,"hasAlpha":true},"hash":"ec42f8f9b8f01e7321aeeae6c740e41e89daf07aed64394ae125300f03618062"},
{"kind":"joinChannel","channels":1,"extraChannels":1,"count":0,"expected":{"width":67,"height":19,"channels":1,"format":"png","space":"b-w","depth":"uchar","density":144,"hasAlpha":false},"hash":"c7630aec8d533041593eb669dcace75bf3f48003a9a0e1f99e677f933f3ae9fd"},
{"kind":"joinChannel","channels":1,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":2,"format":"png","space":"b-w","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"},
{"kind":"joinChannel","channels":1,"extraChannels":1,"count":2,"expected":{"width":67,"height":19,"channels":3,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":false},"hash":"204cbe443a3ea2a658344c2dc8938f45781a79333411e80f09794e9034360107"},
{"kind":"joinChannel","channels":1,"extraChannels":1,"count":4,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"b36bd720480d09ecbaf2725b1990aab0e1f9461110f4f3b20828b72e7ae16456"},
{"kind":"joinChannel","channels":2,"extraChannels":1,"count":0,"expected":{"width":67,"height":19,"channels":2,"format":"png","space":"b-w","depth":"uchar","density":144,"hasAlpha":true},"hash":"c7630aec8d533041593eb669dcace75bf3f48003a9a0e1f99e677f933f3ae9fd"},
{"kind":"joinChannel","channels":2,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":3,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":false},"hash":"c409f021acd38c73343b31b64e3f0ad316b2824d3cf65bb0526a8b3647cd8030"},
{"kind":"joinChannel","channels":2,"extraChannels":1,"count":2,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"c80f74f2287926f22f0160763fe0351703fdd2f4941a82ebba0bcd1d9ca6b061"},
{"kind":"joinChannel","channels":2,"extraChannels":1,"count":4,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"c80f74f2287926f22f0160763fe0351703fdd2f4941a82ebba0bcd1d9ca6b061"},
{"kind":"joinChannel","channels":3,"extraChannels":1,"count":0,"expected":{"width":67,"height":19,"channels":3,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":false},"hash":"c7630aec8d533041593eb669dcace75bf3f48003a9a0e1f99e677f933f3ae9fd"},
{"kind":"joinChannel","channels":3,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"},
{"kind":"joinChannel","channels":3,"extraChannels":1,"count":2,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"},
{"kind":"joinChannel","channels":3,"extraChannels":1,"count":4,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"},
{"kind":"joinChannel","channels":4,"extraChannels":1,"count":0,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"c7630aec8d533041593eb669dcace75bf3f48003a9a0e1f99e677f933f3ae9fd"},
{"kind":"joinChannel","channels":4,"extraChannels":1,"count":1,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"},
{"kind":"joinChannel","channels":4,"extraChannels":1,"count":2,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"},
{"kind":"joinChannel","channels":4,"extraChannels":1,"count":4,"expected":{"width":67,"height":19,"channels":4,"format":"png","space":"srgb","depth":"uchar","density":144,"hasAlpha":true},"hash":"55d79b663fb0fb75ae9802e6c3ce0a6b34494eb3a1794c068753e192e4536b35"}
];
function raster(width:number,height:number,channels:number,seed:number):RgbaImage{return {width,height,channels,data:Uint8Array.from({length:width*height*4},(_,i)=>(i*43+Math.floor(i/7)+seed)%256),format:"png",space:channels<3?"b-w":"srgb",depth:"uchar",density:144,hasAlpha:channels%2===0};}
function backing(base=raster(67,19,1,0),extras=[raster(13,7,1,17)]) {
 const memory=new Uint8Array(Math.max(1_000_000,base.data.length*4+extras.reduce((n,image)=>n+image.data.length,0))),borrowed=new Uint8Array(4096);let end=8;
 const retain=(image:RgbaImage):StoredRgbaImage=>{const position=end;memory.set(image.data,position);end+=image.data.length;const {data:ignored,...metadata}=image;return {...metadata,position};};
 const stored=retain(base),resources=extras.map(retain);
 const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(37);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
 const readImage=vi.fn(async(input:Uint8Array|string)=>resources[Number(input)]!);
 return {base,extras,stored,resources,storage,memory,resolver:{readImage}};
}
it.each(vectors)("preserves committed $kind $op base=$channels extras=$count",async vector=>{
 const extras=Array.from({length:vector.count},(_,i)=>raster([13,71,1,7][i]!,[7,21,1,3][i]!,vector.extraChannels,17+i*23));
 const {base,stored,storage,memory,resolver}=backing(raster(67,19,vector.channels,0),extras);
 const operation:Operation=vector.kind==="boolean"?{kind:"boolean",operand:"0",op:vector.op!}:{kind:"joinChannel",inputs:extras.map((_,i)=>({data:String(i)}))};
 const expected=vector.kind==="boolean"?booleanImage(base,extras[0]!,vector.op!):joinChannelImage(base,extras);
 const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal,resolver);
 expect({...actual,position:undefined}).toEqual(vector.expected);expect({...expected,data:undefined}).toEqual(vector.expected);
 expect(createHash("sha256").update(expected.data).digest("hex")).toBe(vector.hash);
 expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+base.data.length)).digest("hex")).toBe(vector.hash);
 expect(resolver.readImage).toHaveBeenCalledTimes(vector.count);
 expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
const join:Operation={kind:"joinChannel",inputs:[{data:"0"}]};
it("requires an explicit resolver before allocating",async()=>{const {stored,storage}=backing();await expect(transformStoredImage(stored,storage,join,new AbortController().signal)).rejects.toThrow("explicit resolver");expect(storage.allocate).not.toHaveBeenCalled();});
it("validates ignored fourth resources before writing",async()=>{
 const {stored,storage,resolver,resources}=backing(undefined,Array.from({length:4},()=>raster(1,1,1,0)));resolver.readImage.mockImplementation(async input=>Number(input)===3?{...resources[0]!,position:-1}:resources[0]!);
 await expect(transformStoredImage(stored,storage,{kind:"joinChannel",inputs:[0,1,2,3].map(i=>({data:String(i)}))},new AbortController().signal,resolver)).rejects.toThrow("Invalid stored resource dimensions");expect(resolver.readImage).toHaveBeenCalledTimes(4);expect(storage.allocate).not.toHaveBeenCalled();
});
it.each(["resolver","read","write"])("preserves channel %s cancellation",async phase=>{
 const {stored,storage,resolver,resources}=backing(),controller=new AbortController(),reason={phase};let reads=0;
 if(phase==="resolver")resolver.readImage.mockImplementationOnce(async()=>{controller.abort(reason);return resources[0]!;});
 if(phase==="read"){const read=storage.read.getMockImplementation()!;storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);reads=storage.read.mock.calls.length;controller.abort(reason);return bytes;});}
 if(phase==="write")storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;controller.abort(reason);});
 await expect(transformStoredImage(stored,storage,join,controller.signal,resolver)).rejects.toBe(reason);expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
});
it.each(["read","write","allocation"])("propagates channel %s failures",async phase=>{
 const {stored,storage,resolver}=backing(),reason=new Error(phase);
 if(phase==="read")storage.read.mockResolvedValueOnce(new Uint8Array(3));if(phase==="write")storage.write.mockRejectedValueOnce(reason);if(phase==="allocation")storage.allocate.mockReturnValueOnce(-1);
 const result=transformStoredImage(stored,storage,join,new AbortController().signal,resolver);
 if(phase==="write")await expect(result).rejects.toBe(reason);else await expect(result).rejects.toThrow(phase==="read"?"Truncated image backing storage":"Invalid image backing allocation");
});
it("keeps Boolean operand caches and join chunks bounded across borrowed pages",async()=>{
 for(const kind of ["boolean","joinChannel"] as const){const {base,extras,stored,storage,memory,resolver}=backing(raster(1031,37,1,0),[raster(997,39,1,13)]),expected=kind==="boolean"?booleanImage(base,extras[0]!,"eor"):joinChannelImage(base,extras),Original=Uint8Array;
 vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.length??0;if(length>4096)throw new Error("unbounded channel bytes");return Reflect.construct(target,args);}}));
 try{const op:Operation=kind==="boolean"?{kind,operand:"0",op:"eor"}:join,actual=await transformStoredImage(stored,storage,op,new AbortController().signal,resolver);expect(Buffer.compare(memory.subarray(actual.position,actual.position+base.data.length),expected.data)).toBe(0);expect(storage.read.mock.calls.length).toBeGreaterThan(32);}finally{vi.unstubAllGlobals();}}
});
function injected(fs:MemoryFileSystem,overrides:Partial<FileSystem>={},whole=false):FileSystem{return new Proxy(fs,{get(target,key){if(Object.hasOwn(overrides,key))return Reflect.get(overrides,key);if(!whole&&(key==="readFile"||key==="writeFile"))return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});}
async function files(large=false){const fs=new MemoryFileSystem(),width=large?513:17,height=large?513:11,bytes=sharp({create:{width,height,channels:4,background:"red"}}).png().toBufferSync();await fs.writeFile("/in.png",bytes);await fs.writeFile("/extra.png",bytes);await fs.writeFile("/out.png",Uint8Array.of(42));return {fs,bytes};}
it.each(["identity","version"])("rejects secondary %s drift and preserves destination",async kind=>{
 const {fs}=await files(),close=vi.fn(),filesystem=injected(fs,{openReadFile:async(path,options)=>{const handle=await fs.openReadFile(path,options);if(path!=="/extra.png")return handle;let stats=0;return {read:handle.read.bind(handle),stat:async io=>{const stat=await handle.stat(io);return stats++===0?stat:kind==="identity"?{...stat,ino:stat.ino!+1}:{...stat,mtimeMs:stat.mtimeMs+1};},close:async()=>{close();await handle.close();}};}});
 await expect(sharp("/in.png",{filesystem}).boolean("/extra.png","and").png().toFile("/out.png")).rejects.toMatchObject({code:"EAGAIN"});expect(close).toHaveBeenCalledTimes(1);expect(await fs.readFile("/out.png")).toEqual(Uint8Array.of(42));expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["extra.png","in.png","out.png"]);
});
it("preserves abort reason over secondary close failure and closes spilled scratch",async()=>{
 const {fs}=await files(true),controller=new AbortController(),reason={cancel:"extra"};let opened=0,closed=0,extraClosed=0;
 const filesystem=injected(fs,{open:async(...args)=>{const descriptor=await fs.open(...args);opened++;return new Proxy(descriptor,{get(target,key){if(key==="close")return async()=>{closed++;await descriptor.close();};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});},openReadFile:async(path,options)=>{const handle=await fs.openReadFile(path,options);if(path!=="/extra.png")return handle;controller.abort(reason);return {read:handle.read.bind(handle),stat:handle.stat.bind(handle),close:async()=>{extraClosed++;await handle.close();throw new Error("close failed");}};}});
 await expect(sharp("/in.png",{filesystem,signal:controller.signal}).joinChannel("/extra.png").png().toFile("/out.png")).rejects.toBe(reason);expect(opened).toBeGreaterThan(0);expect(closed).toBe(opened);expect(extraClosed).toBe(1);expect(await fs.readFile("/out.png")).toEqual(Uint8Array.of(42));
});
it("uses the parent filesystem authority for a secondary path",async()=>{
 const {fs}=await files(),foreign={readFile:vi.fn(async()=>{throw new Error("foreign authority");}),writeFile:vi.fn(async()=>{})};
 await sharp("/in.png",{filesystem:injected(fs)}).boolean("/extra.png","and",{filesystem:foreign}).png().toFile("/out.png");expect(foreign.readFile).not.toHaveBeenCalled();
});
it("closes unsupported resources and scratch before buffered fallback",async()=>{
 const {fs}=await files(true),resource=sharp({create:{width:3,height:2,channels:4,background:"blue"}}).toFormat("pdf").toBufferSync();await fs.writeFile("/extra.png",resource);let opened=0,closed=0,extraClosed=false,fallback=0;
 const filesystem=injected(fs,{capabilitiesFor:async(_path,options)=>({...fs.capabilities,retainedStagingWrite:options?.create?false:fs.capabilities.retainedStagingWrite}),open:async(...args)=>{const descriptor=await fs.open(...args);opened++;return new Proxy(descriptor,{get(target,key){if(key==="close")return async()=>{closed++;await descriptor.close();};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});},openReadFile:async(path,options)=>{const handle=await fs.openReadFile(path,options);return {read:handle.read.bind(handle),stat:handle.stat.bind(handle),close:async()=>{if(path==="/extra.png")extraClosed=true;await handle.close();}};},readFile:async(...args)=>{fallback++;expect(extraClosed).toBe(true);expect(closed).toBe(opened);return fs.readFile(...args);}},true);
 const expected=sharp(await fs.readFile("/in.png")).joinChannel(resource).png().toBufferSync();await sharp("/in.png",{filesystem}).joinChannel("/extra.png").png().toFile("/out.png");expect(fallback).toBeGreaterThan(0);expect(opened).toBeGreaterThan(0);expect(Buffer.compare(sharp(await fs.readFile("/out.png")).raw().toBufferSync(),sharp(expected).raw().toBufferSync())).toBe(0);
});
it("reports close failure instead of falling back from unsupported secondary format",async()=>{
 const {fs}=await files(),reason=new Error("resource close failed");await fs.writeFile("/extra.png",Uint8Array.of(1,2,3));const fallback=vi.fn(async()=>new Uint8Array());
 const filesystem=injected(fs,{readFile:fallback,openReadFile:async(path,options)=>{const handle=await fs.openReadFile(path,options);if(path!=="/extra.png")return handle;return {read:handle.read.bind(handle),stat:handle.stat.bind(handle),close:async()=>{await handle.close();throw reason;}};}},true);
 await expect(sharp("/in.png",{filesystem}).joinChannel("/extra.png").png().toFile("/out.png")).rejects.toBe(reason);expect(fallback).not.toHaveBeenCalled();expect(await fs.readFile("/out.png")).toEqual(Uint8Array.of(42));
});
it("decodes sliced Buffer PNG input with owned range bytes",async()=>{
 const {bytes}=await files(),buffer=Buffer.alloc(bytes.length+22);buffer.set(bytes,11);const input=buffer.subarray(11,11+bytes.length),{storage,memory}=backing();
 const actual=await readImageResource(input,undefined,new MemoryFileSystem(),storage,new AbortController().signal),expected=sharp(bytes).raw().toBufferSync();expect(Buffer.compare(memory.subarray(actual.position,actual.position+expected.length),expected)).toBe(0);expect(input).toEqual(Buffer.from(bytes));
});
it("rejects unsupported byte resources without acquiring filesystem authority",async()=>{const {storage}=backing(),fs=new MemoryFileSystem(),open=vi.spyOn(fs,"openReadFile");await expect(readImageResource(Uint8Array.of(1,2,3),undefined,fs,storage,new AbortController().signal)).rejects.toBeInstanceOf(UnsupportedStoredResource);expect(open).not.toHaveBeenCalled();});
