import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {applyRetainedLuaFilter} from "./lua-retained-filter.js";

const document={"pandoc-api-version":[1,23,1],meta:{},blocks:[{t:"Para",c:[{t:"Str",c:"hello"}]}]};
async function apply(source:string | AsyncIterable<Uint8Array>,signal?:AbortSignal,setup?:(context:ExecutionContext)=>void):Promise<unknown> {
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",signal?{signal}:{});
  const owner={fs,cwd:"/",env:{},signal:signal??new AbortController().signal};
  const stores=Array.from({length:3},()=>new PagedStorage(owner,64));
  const cooperate=(units?:number)=>context.cooperate(units),input=new BackedJson(stores[0]!,cooperate),output=new BackedJson(stores[1]!,cooperate);
  try {
    await input.value(document);setup?.(context);
    await applyRetainedLuaFilter(input,output,(typeof source==="string"?(async function*(){yield new TextEncoder().encode(source);})():source),stores[2]!,new LuaStorage(stores[2]!,cooperate),context,"html","/filter.lua");
    let text="";for await(const chunk of output.chunks())text+=new TextDecoder().decode(chunk);
    return JSON.parse(text);
  } finally {for(const store of stores)await store.close();await context.close();expect(await fs.readdir("/")).toEqual([]);}
}
it("runs Pandoc constructors and string callbacks through retained Lua",async()=>{
  expect(await apply("function Str(el) return pandoc.Str(string.upper(el.text)..'!') end")).toEqual({...document,blocks:[{t:"Para",c:[{t:"Str",c:"HELLO!"}]}]});
});
it("freezes returned filter callbacks before callbacks mutate their tables",async()=>{
  expect(await apply("local f; f={Str=function(el) f.Str=function() return pandoc.Str('bad') end; return pandoc.Str(el.text..'!') end}; return {f,f}")).toEqual({...document,blocks:[{t:"Para",c:[{t:"Str",c:"hello!!"}]}]});
});
it("keeps the Pandoc runner rooted when a script replaces internal globals",async()=>{
  expect(await apply("__pandoc_run=function() error('bad runner') end; function Str(el) el.text=FORMAT; return el end")).toEqual({...document,blocks:[{t:"Para",c:[{t:"Str",c:"html"}]}]});
});
it("preserves newly constructed empty metadata maps",async()=>{
  expect(await apply("function Meta(meta) meta.test=pandoc.MetaMap({}); return meta end")).toEqual({...document,meta:{test:{t:"MetaMap",c:{}}}});
});
it.each(["return {Unsupported=function() end}","return 7"])("rejects unsupported returned filter declarations: %s",async source=>{
  await expect(apply(source)).rejects.toMatchObject({code:"E_UNSUPPORTED_FEATURE"});
});
it("protects callback admission from mutations of the bootstrap callback table",async()=>{
  expect(await apply("__pandoc_callbacks.Str=nil; function Str(el) return pandoc.Str('protected') end")).toEqual({...document,blocks:[{t:"Para",c:[{t:"Str",c:"protected"}]}]});
});
it("captures the script's current global table alias",async()=>{
  expect(await apply("_G={Str=function() return pandoc.Str('alias') end}")).toEqual({...document,blocks:[{t:"Para",c:[{t:"Str",c:"alias"}]}]});
});

it("closes an early-invalid source without consuming its tail",async()=>{
  const tail=vi.fn(),closed=vi.fn();
  const source=(async function*(){try {yield new TextEncoder().encode("function ) invalid");tail();throw new Error("unreachable tail");}finally{closed();}})();
  await expect(apply(source)).rejects.toMatchObject({code:"E_AST"});
  expect(tail).not.toHaveBeenCalled();expect(closed).toHaveBeenCalledOnce();
});
it("cancels an actual Pandoc callback and cleans retained state",async()=>{
  const controller=new AbortController();
  await expect(apply("function Str(el) while true do end end",controller.signal,context=>{
    const bound=context.bound.bind(context);let scheduled=false;
    vi.spyOn(context,"bound").mockImplementation((key,value)=>{bound(key,value);if(key==="depth" && !scheduled){scheduled=true;setTimeout(()=>controller.abort(),0);}});
  })).rejects.toMatchObject({code:"E_CANCELLED"});
});
it("retains script error values for the boundary adapter",async()=>{
  await expect(apply("function Str(el) error(string.rep('x',17003)) end")).rejects.toMatchObject({code:"E_AST",message:"Lua error",value:{kind:"string"},level:1});
});
it("rejects bytecode filter sources at the retained compiler boundary",async()=>{
  await expect(apply((async function*(){yield Uint8Array.of(27,76,117,97);})())).rejects.toMatchObject({code:"E_UNSUPPORTED_FEATURE"});
});
