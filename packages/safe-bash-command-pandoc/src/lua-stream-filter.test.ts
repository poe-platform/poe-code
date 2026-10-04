import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createLuaFilterCapability} from "./lua-filters.js";
import {ExecutionContext} from "./execution.js";

const encoder=new TextEncoder(),document={"pandoc-api-version":[1,23,1,2],meta:{},blocks:[{t:"Para",c:[{t:"Str",c:"hello"}]}]};
it("exposes a caller-backed Lua protocol path without invoking buffered apply",async()=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{workingFiles:{fs,directory:"/",cacheBytes:16384}});
  const readFile=vi.fn(()=>{throw new Error("buffered reader");});
  const capability=createLuaFilterCapability({readFile,readStream:async function*(){yield encoder.encode("function Str(el) return pandoc.Str(string.upper(el.text)) end");}});
  let output="";
  try {
    expect(capability.applyJsonStream).toBeTypeOf("function");
    await capability.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{async write(bytes){output+=new TextDecoder().decode(bytes);}},signal:new AbortController().signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}));
    expect(JSON.parse(output)).toEqual({...document,blocks:[{t:"Para",c:[{t:"Str",c:"HELLO"}]}]});
    expect(readFile).not.toHaveBeenCalled();
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("streams a large Lua error before releasing scratch and preserves error identity",async()=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{workingFiles:{fs,directory:"/",cacheBytes:16384}});
  let delivered:unknown,total=0,largest=0;
  const capability=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("error(string.rep('x',17003),0)");},async onError(error,chunks){
    delivered=error;
    for await(const bytes of chunks){largest=Math.max(largest,bytes.length);total+=bytes.length;expect(bytes.every(byte=>byte===120)).toBe(true);}
  }});
  try {
    await expect(capability.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:vi.fn()},signal:new AbortController().signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}))).rejects.toSatisfy(error=>error===delivered);
    expect(total).toBe(17003);expect(largest).toBeLessThanOrEqual(8192);
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("selects retained Lua from the public output conversion path",async()=>{
  const {convertToOutput}=await import("./index.js");
  const fs=new MemoryFileSystem(),filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("function Str(el) return pandoc.Str('stream') end");}});
  vi.spyOn(filters,"apply").mockRejectedValue(new Error("buffered filter invoked"));
  let result="";
  await convertToOutput([{bytes:encoder.encode(JSON.stringify(document))}],{from:"json",to:"plain",filters:[{kind:"lua",path:"/filter.lua"}]},{workingFiles:{fs,directory:"/",cacheBytes:16384},filters,output:{async write(bytes){result+=new TextDecoder().decode(bytes);},async close(){},async abort(){}}});
  expect(result).toBe("stream\n");expect(await fs.readdir("/")).toEqual([]);
});

it("preserves a delivered diagnostic identity through public conversion",async()=>{
  const {convertToOutput}=await import("./index.js");
  const fs=new MemoryFileSystem();let delivered:unknown;
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("error('broken',0)");},async onError(error,chunks){for await(const bytes of chunks)expect(new TextDecoder().decode(bytes)).toBe("broken");delivered=error;}});
  await expect(convertToOutput([{bytes:encoder.encode(JSON.stringify(document))}],{from:"json",to:"json",filters:[{kind:"lua",path:"/filter.lua"}]},{workingFiles:{fs,directory:"/",cacheBytes:16384},filters,output:{write:vi.fn(),close:vi.fn(),abort:vi.fn()}})).rejects.toSatisfy(error=>error===delivered);
  expect(await fs.readdir("/")).toEqual([]);
});

it("runs the command's VFS Lua stream and writes a large diagnostic exactly once",async()=>{
  const {createPandocCommand}=await import("./command.js");
  const fs=new MemoryFileSystem();await fs.writeFile("/filter.lua",encoder.encode("error(string.rep('x',17003),0)"));
  const readFile=vi.spyOn(fs,"readFile").mockRejectedValue(new Error("whole-file read"));
  let stderr="",largest=0;const stdout=vi.fn(async()=>{});
  expect(await createPandocCommand().execute({command:"pandoc",args:["-fjson","-tjson","-L","/filter.lua"],cwd:"/",env:{},fs,signal:new AbortController().signal,stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:stdout},stderr:{async write(bytes){largest=Math.max(largest,bytes.length);stderr+=new TextDecoder().decode(bytes);}}})).toEqual({exitCode:4});
  expect(stderr).toBe("E_AST: "+"x".repeat(17003)+"\n");expect(largest).toBeLessThanOrEqual(8192);
  expect(stdout).not.toHaveBeenCalled();expect(readFile).not.toHaveBeenCalled();expect(await fs.readdir("/")).toEqual([{name:"filter.lua",type:"file"}]);
});

it("preserves Lua source locations in streamed and buffered error messages",async()=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{workingFiles:{fs,directory:"/",cacheBytes:16384}});
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("local x=1\nerror('broken')");}});
  try {
    await expect(filters.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:vi.fn()},signal:new AbortController().signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}))).rejects.toMatchObject({message:'[string "/filter.lua"]:2: broken'});
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("cancels a public retained callback and retires all backing storage",async()=>{
  const fs=new MemoryFileSystem(),controller=new AbortController(),context=new ExecutionContext("convert",{signal:controller.signal,workingFiles:{fs,directory:"/",cacheBytes:16384}});
  let scheduled=false;const bound=context.bound.bind(context);
  vi.spyOn(context,"bound").mockImplementation((key,value)=>{bound(key,value);if(key==="depth" && !scheduled){scheduled=true;setTimeout(()=>controller.abort(),0);}});
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("function Str(el) while true do end end");}});
  try {
    await expect(filters.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:vi.fn()},signal:controller.signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}))).rejects.toMatchObject({code:"E_CANCELLED"});
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("cleans backing storage when an error consumer rejects",async()=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{workingFiles:{fs,directory:"/",cacheBytes:16384}}),failure=new Error("diagnostic destination failed");
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("error('broken',0)");},async onError(){throw failure;}});
  try {
    await expect(filters.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:vi.fn()},signal:new AbortController().signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}))).rejects.toBe(failure);
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it.each([
  ["function Str(","E_IO"],
  ["error('broken',0)","E_IO"],
  ["function Str(el) return io.open('host') end","E_IO"],
  ["function Str(el) return 123 end","E_AST"],
  ["return {Str=7}","E_AST"]
])("preserves legacy loader diagnostics in retained execution: %s",async(source,code)=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{workingFiles:{fs,directory:"/",cacheBytes:16384}});
  const filters=createLuaFilterCapability(async()=>encoder.encode(source));
  try {
    await expect(filters.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:vi.fn()},signal:new AbortController().signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}))).rejects.toMatchObject({code});
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("preserves relative image targets in retained Lua HTML output",async()=>{
  const {convertToOutput}=await import("./index.js");
  const fs=new MemoryFileSystem(),filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("function Image(el) return el end");}});
  const image={...document,blocks:[{t:"Para",c:[{t:"Image",c:[["",[],[]],[{t:"Str",c:"alt"}],["relative.png",""]]}]}]};
  let text="";
  await convertToOutput([{bytes:encoder.encode(JSON.stringify(image))}],{from:"json",to:"html",filters:[{kind:"lua",path:"/filter.lua"}]},{workingFiles:{fs,directory:"/",cacheBytes:16384},filters,output:{async write(bytes){text+=new TextDecoder().decode(bytes);},async close(){},async abort(){}}});
  expect(text).toContain('src="relative.png"');expect(await fs.readdir("/")).toEqual([]);
});

it("preserves original image directories for Lua resource writers",async()=>{
  const {convertToOutput}=await import("./index.js");
  const fs=new MemoryFileSystem();await fs.mkdir("/origin");await fs.writeFile("/origin/relative.png",new Uint8Array());
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode("function Image(el) return el end");}});
  const image={...document,blocks:[{t:"Para",c:[{t:"Image",c:[["",[],[]],[],["relative.png",""]]}]}]};
  const readFile=vi.fn(async()=>{throw new Error("stop before decode");});
  await expect(convertToOutput([{base:"/origin",bytes:encoder.encode(JSON.stringify(image))}],{from:"json",to:"rtf",filters:[{kind:"lua",path:"/filter.lua"}]},{workingFiles:{fs,directory:"/",cacheBytes:16384},filters,resourceFiles:{lstat:path=>fs.lstat(path),readFile,mkdir:path=>fs.mkdir(path),writeFile:(path,bytes)=>fs.writeFile(path,bytes)},output:{write:vi.fn(),close:vi.fn(),abort:vi.fn()}})).rejects.toBeDefined();
  expect(readFile).toHaveBeenCalledWith("/origin/relative.png",expect.anything());
  expect(await fs.readdir("/")).toEqual([{name:"origin",type:"directory"}]);
});

it.each([["1.0","1.0"],["1/3","0.33333333333333"]])("preserves numeric Lua error formatting: %s",async(value,message)=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{workingFiles:{fs,directory:"/",cacheBytes:16384}});
  const filters=createLuaFilterCapability({readStream:async function*(){yield encoder.encode(`error(${value})`);}});
  try {
    await expect(filters.applyJsonStream!({stdin:(async function*(){yield encoder.encode(JSON.stringify(document));})(),stdout:{write:vi.fn()},signal:new AbortController().signal},{kind:"lua",path:"/filter.lua"},Object.assign(context,{to:"json"}))).rejects.toMatchObject({message});
  } finally {await context.close();expect(await fs.readdir("/")).toEqual([]);}
});


it.each([false,true].flatMap(asynchronous=>[false,true].map(cleanupFails=>({asynchronous,cleanupFails}))))("closes a retained reader cancelled by its factory without pulling ($asynchronous, cleanup failure $cleanupFails)",async({asynchronous,cleanupFails})=>{
  const {convertToOutput}=await import("./index.js");
  const fs=new MemoryFileSystem(),controller=new AbortController();
  const next=vi.fn(()=>({done:false as const,value:encoder.encode("return {}")}));
  const close=vi.fn(()=>{if(cleanupFails)throw new Error("cleanup failed");return {done:true as const,value:undefined};});
  const filters=createLuaFilterCapability({readStream(){
    controller.abort();
    return asynchronous
      ? {[Symbol.asyncIterator](){return {async next(){return next();},async return(){return close();}};}}
      : {[Symbol.iterator](){return {next,return:close};}};
  }});
  const write=vi.fn();
  await expect(convertToOutput([{bytes:encoder.encode(JSON.stringify(document))}],{from:"json",to:"plain",filters:[{kind:"lua",path:"/filter.lua"}]},{signal:controller.signal,workingFiles:{fs,directory:"/",cacheBytes:16384},filters,output:{write,async close(){},async abort(){}}})).rejects.toMatchObject({code:"E_CANCELLED"});
  expect(next).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});
