import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {RetainedOrigins} from "./retained-origins.js";
import {ExecutionContext} from "./execution.js";
import {transformRetainedJson} from "./retained-transforms.js";
const image=(url:string,title="")=>({t:"Image",c:[["",[],[]],[],[url,title]]});
async function targets(tree:BackedJson,origins:RetainedOrigins):Promise<[string,boolean][]> {
  const result:[string,boolean][]=[];const end=(await tree.describe(tree.rootPosition)).end;
  for(let node=tree.rootPosition;node<end;){
    const header=await tree.describe(node);
    if(header.kind==="object") {
      const tag=await tree.property(node,"t");
      if(tag!==undefined && await tree.smallText(tag,5)==="Image"){
        let target=(await tree.property(node,"c"))!+32;for(let i=0;i<2;i++)target=(await tree.describe(target)).end;
        result.push([(await tree.smallText(target+32,64))!,await origins.inherited(target+32)]);
      }
    }
    node=header.kind==="object" || header.kind==="array"?node+32:header.end;
  }
  return result;
}
it("matches long and colliding metadata keys while retaining tuple identity across generations",async()=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{}),owner={fs,cwd:"/",env:{},signal:new AbortController().signal};
  const stores=Array.from({length:3},()=>new PagedStorage(owner,1)),cooperate=(units?:number)=>context.cooperate(units);
  const before=new BackedJson(stores[0]!,cooperate),after=new BackedJson(stores[1]!,cooperate),origins=new RetainedOrigins(stores[2]!,cooperate);
  const key="x".repeat(9000),inline=(items:ReturnType<typeof image>[])=>({t:"MetaInlines",c:items});
  try {
    await before.value({meta:{[key]:inline([image("long.jpg")]),costarring:inline([image("a.jpg")]),liquid:inline([image("b.jpg")])},blocks:[]});
    await after.value({blocks:[],meta:{liquid:inline([image("b.jpg","changed")]),costarring:inline([image("a.jpg")]),[key]:inline([image("long.jpg")])}});
    await origins.transfer(before,after);
    expect(await targets(after,origins)).toEqual([["b.jpg",false],["a.jpg",true],["long.jpg",true]]);
    await origins.transfer(after,after);
    expect(await targets(after,origins)).toEqual([["b.jpg",false],["a.jpg",true],["long.jpg",true]]);
    origins.clear();expect((await targets(after,origins)).every(([,value])=>!value)).toBe(true);
  }finally{for(const store of stores)await store.close();await context.close();expect(await fs.readdir("/")).toEqual([]);}
});
it("carries origins through comment deletion and heading-to-paragraph transformation",async()=>{
  const fs=new MemoryFileSystem(),context=new ExecutionContext("convert",{}),owner={fs,cwd:"/",env:{},signal:new AbortController().signal};
  const stores=Array.from({length:3},()=>new PagedStorage(owner,1)),cooperate=(units?:number)=>context.cooperate(units);
  const before=new BackedJson(stores[0]!,cooperate),after=new BackedJson(stores[1]!,cooperate),origins=new RetainedOrigins(stores[2]!,cooperate);
  const document=(replacement:string)=>({"pandoc-api-version":[1,23,1,2],meta:{},blocks:[{t:"RawBlock",c:["html","<!--gone-->"]},{t:"Header",c:[1,["",[],[]],[image("a.jpg"),image(replacement)]]}]});
  try {
    await before.value(document("b.jpg"));await after.value(document("a.jpg"));await origins.transfer(before,after);
    const transformed=await transformRetainedJson(after,context,{fs,directory:"/",cacheBytes:16384},{stripComments:true,shiftHeadingLevelBy:-1},origins.copy());
    try {expect(await targets(transformed.tree,origins)).toEqual([["a.jpg",true],["a.jpg",false]]);}finally{await transformed.close();}
  }finally{for(const store of stores)await store.close();await context.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("indexes wide object keys without repeatedly scanning their payloads",async()=>{
  const fs=new MemoryFileSystem(),owner={fs,cwd:"/",env:{},signal:new AbortController().signal},stores=Array.from({length:3},()=>new PagedStorage(owner,1));
  const cooperate=async()=>{},before=new BackedJson(stores[0]!,cooperate),after=new BackedJson(stores[1]!,cooperate);
  const entries=Array.from({length:256},(_,i)=>["key"+String(i).padStart(3,"0"),i] as const);
  try {
    await before.value(Object.fromEntries(entries));await after.value(Object.fromEntries(entries.slice().reverse()));
    const reads=vi.spyOn(before,"scalarChunks");
    await new RetainedOrigins(stores[2]!,cooperate).transfer(before,after);
    expect(reads.mock.calls.length).toBeLessThan(1024);
  }finally{for(const store of stores)await store.close();expect(await fs.readdir("/")).toEqual([]);}
});

it("clears typed replacements even with identical tuples while retaining deep MetaMap siblings", async () => {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const stores = Array.from({length: 4}, () => new PagedStorage(owner, 1)), cooperate = async () => {};
  const before = new BackedJson(stores[0]!, cooperate), after = new BackedJson(stores[1]!, cooperate), overlay = new BackedJson(stores[2]!, cooperate), origins = new RetainedOrigins(stores[3]!, cooperate);
  const inline = (name: string) => ({t: "MetaInlines", c: [image(name)]});
  const key = "x".repeat(9000);
  let meta: Parameters<BackedJson["value"]>[0] = {costarring: inline("keep.jpg"), liquid: inline("replace.jpg"), [key]: inline("long.jpg")};
  let change: Parameters<BackedJson["value"]>[0] = {liquid: inline("replace.jpg"), [key]: inline("long.jpg")};
  for (let index = 0; index < 64; index++) {meta = {nested: {t: "MetaMap", c: meta}}; change = {nested: {t: "MetaMap", c: change}};}
  try {
    await before.value({meta, blocks: []}); await after.value({meta, blocks: []}); await overlay.value(change);
    await origins.transfer(before, after, overlay);
    expect(await targets(after, origins)).toEqual([["keep.jpg", true], ["replace.jpg", false], ["long.jpg", false]]);
    await origins.transfer(after, after);
    expect(await targets(after, origins)).toEqual([["keep.jpg", true], ["replace.jpg", false], ["long.jpg", false]]);
  } finally {for (const store of stores) await store.close(); expect(await fs.readdir("/")).toEqual([]);}
});

it("retains distinct source identities across copies and Lua tuple matching", async () => {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const stores = Array.from({length: 3}, () => new PagedStorage(owner, 1));
  const before = new BackedJson(stores[0]!, async () => {}), after = new BackedJson(stores[1]!, async () => {}), origins = new RetainedOrigins(stores[2]!, async () => {});
  try {
    await before.value({meta: {}, blocks: [image("a"), image("b")]});
    await after.value({meta: {}, blocks: [image("a"), image("b")]});
    const locations = async (tree: BackedJson) => {
      const result: number[] = [];
      for await (const block of tree.children((await tree.property(tree.rootPosition, "blocks"))!)) {
        let target = (await tree.property(block, "c"))! + 32;
        for (let i = 0; i < 2; i++) target = (await tree.describe(target)).end;
        result.push(target + 32);
      }
      return result;
    };
    const old = await locations(before), fresh = await locations(after);
    origins.clear(); await origins.seed(old[0]!, 2); await origins.seed(old[1]!, 3);
    await origins.transfer(before, after);
    expect(await Promise.all(fresh.map(node => origins.source(node)))).toEqual([2, 3]);
    const copy = origins.copy(); await copy(fresh[0]!, 100); await copy(fresh[1]!, 200);
    expect(await origins.source(100)).toBe(2); expect(await origins.source(200)).toBe(3);
    origins.clear(); expect(await origins.source(100)).toBe(0);
  } finally {for (const store of stores) await store.close(); expect(await fs.readdir("/")).toEqual([]);}
});
