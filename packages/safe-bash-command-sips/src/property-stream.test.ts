import {expect,it} from "vitest";
import {writeProperties} from "./properties.js";
import {writePropertiesStream} from "./index.js";

for(const format of ["png","jpeg"] as const)for(const chunkSize of [1,7,64,32768])
it(`inserts ${format} properties across ${chunkSize}-byte chunks`,async()=>{
 const bytes=Uint8Array.from({length:chunkSize<64?113:100_000},(_,i)=>i%251),properties=new Map<string,string|null>([["description","x".repeat(64000)],["dpiWidth",null]]),expected=writeProperties(bytes,format,properties);
 const source=(async function*(){for(let position=0;position<bytes.length;position+=chunkSize)yield bytes.subarray(position,position+chunkSize);})();
 const chunks:Uint8Array[]=[];let size=0;
 for await(const chunk of writePropertiesStream(source,format,properties,new AbortController().signal)){expect(chunk.length).toBeLessThanOrEqual(16384);chunks.push(chunk);size+=chunk.length;}
 const actual=new Uint8Array(size);let position=0;for(const chunk of chunks){actual.set(chunk,position);position+=chunk.length;}
 expect(actual).toEqual(expected);
});

it("honors backpressure and releases the encoder when canceled",async()=>{
 let pulled=0,closed=0;const source=(async function*(){try{for(let i=0;i<10;i++){pulled++;yield new Uint8Array(1000);}}finally{closed++;}})();
 const stream=writePropertiesStream(source,"png",new Map([["description","v"]]),new AbortController().signal);
 expect(pulled).toBe(0);await stream.next();expect(pulled).toBe(1);await stream.return();expect(pulled).toBe(1);expect(closed).toBe(1);
});

it("owns yielded chunks even if the encoder reuses its buffer",async()=>{
 const bytes=new Uint8Array(40).fill(7),source=(async function*(){yield bytes;bytes.fill(9);yield bytes;})();
 const chunks:Uint8Array[]=[];for await(const chunk of writePropertiesStream(source,"png",new Map(),new AbortController().signal))chunks.push(chunk);
 expect(chunks[0]).toEqual(new Uint8Array(40).fill(7));expect(chunks[1]).toEqual(new Uint8Array(40).fill(9));
});

it("observes abort and awaits encoder cleanup",async()=>{
 const controller=new AbortController(),reason=new Error("abort properties");let closed=false;
 const source=(async function*(){try{yield new Uint8Array(100);controller.abort(reason);yield new Uint8Array(100);}finally{await Promise.resolve();closed=true;}})();
 await expect((async()=>{for await(const ignoredChunk of writePropertiesStream(source,"png",new Map([["description","v"]]),controller.signal)){/* consume */}})()).rejects.toBe(reason);expect(closed).toBe(true);
});

it("rejects truncated insertion headers and unsupported metadata formats",async()=>{
 const collect=async(format:"png"|"gif")=>{for await(const ignoredChunk of writePropertiesStream((async function*(){yield new Uint8Array(2);})(),format,new Map([["description","v"]]),new AbortController().signal)){/* consume */}};
 await expect(collect("png")).rejects.toThrow("Truncated");await expect(collect("gif")).rejects.toThrow("property persistence is not supported");
});

it("owns chunks from Uint8Array subclasses whose slice returns a view",async()=>{
 class ViewBytes extends Uint8Array {override slice(start?:number,end?:number){return this.subarray(start,end);}}
 const bytes=new ViewBytes(40).fill(7),source=(async function*(){yield bytes;bytes.fill(9);yield bytes;})();
 const chunks:Uint8Array[]=[];for await(const chunk of writePropertiesStream(source,"png",new Map(),new AbortController().signal))chunks.push(chunk);
 expect(chunks[0]).toEqual(new Uint8Array(40).fill(7));
});

it("yields to cancellation when the encoder emits only empty chunks",async()=>{
 const controller=new AbortController(),reason=new Error("empty stream cancel");let pulled=0,closed=0;
 const source=(async function*(){try{for(let i=0;i<10000;i++){pulled++;yield new Uint8Array();}}finally{closed++;}})();
 const timer=setTimeout(()=>controller.abort(reason),0);
 try{await expect((async()=>{for await(const ignoredChunk of writePropertiesStream(source,"png",new Map(),controller.signal)){/* consume */}})()).rejects.toBe(reason);expect(pulled).toBeLessThan(10000);expect(closed).toBe(1);}finally{clearTimeout(timer);}
});

import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";
it("streams metadata insertion through external Worker services above the working window",async()=>{
 const bytes=Uint8Array.from({length:2*1024*1024+37},(_,index)=>index%251),expected=writeProperties(bytes,"png",new Map([["description","x".repeat(64000)]])),chunks:Uint8Array[]=[];
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"property-worker.ts",contents:`
 import {writePropertiesStream} from './packages/safe-bash-command-sips/src/index.ts';
 export default {async fetch(request,env){const {size}=await request.json();let read=0,written=0,maxAllocation=0;const Native=Uint8Array;
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded property allocation');return Reflect.construct(target,args);}});
 try{const source=(async function*(){for(let position=0;position<size;position+=16384){const length=Math.min(16384,size-position),response=await env.SOURCE.fetch('https://source/?position='+position+'&length='+length);read+=length;yield new Uint8Array(await response.arrayBuffer());}})();
 for await(const chunk of writePropertiesStream(source,'png',new Map([['description','x'.repeat(64000)]]),new AbortController().signal)){if(chunk.length>16384)throw new Error('large transfer');await env.SINK.fetch('https://sink/',{method:'POST',body:chunk});written+=chunk.length;}
 return Response.json({read,written,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{globalThis.Uint8Array=Native;}}};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{SOURCE:async(request:Request)=>{const url=new URL(request.url),position=Number(url.searchParams.get("position")),length=Number(url.searchParams.get("length"));return new Response(bytes.slice(position,position+length));},SINK:async(request:Request)=>{chunks.push(new Uint8Array(await request.arrayBuffer()));return new Response();}}});
 try{const response=await runtime.dispatchFetch("https://properties/",{method:"POST",body:JSON.stringify({size:bytes.length})});expect(response.status).toBe(200);const result=await response.json() as {read:number;written:number;maxAllocation:number;nodeGlobals:boolean};expect(result.read).toBe(bytes.length);expect(result.written).toBe(expected.length);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);let position=0;for(const chunk of chunks){expect(chunk).toEqual(expected.subarray(position,position+chunk.length));position+=chunk.length;}expect(position).toBe(expected.length);}
 finally{await runtime.dispose();}
},15000);
