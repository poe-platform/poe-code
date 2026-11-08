import {expect,it} from "vitest";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {fileURLToPath} from "node:url";

it("queries SVG metadata in a Worker without materializing a large header or body",async()=>{
 const first=new TextEncoder().encode('<svg data-padding="'),last=new TextEncoder().encode('" width="13" height="7">'),padding=1024*1024,headerLength=first.length+padding+last.length,size=headerLength+500_000_000;
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../",import.meta.url)),sourcefile:"svg-query-worker.ts",contents:`
 import {runSipsCli} from './packages/safe-bash-command-sips/src/index.ts';
 export default {async fetch(request,env){const {size}=await request.json();let admitted=0,closed=0,maxAllocation=0;const scope={};const stat=()=>({type:'file',size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:'input',opaqueVersion:'1'});
 const fs={capabilities:{retainedRead:true},async openReadFile(){return {async stat(){return stat();},async read(position,length){if(admitted!==size||length>4096)throw Error('unbounded or unadmitted SVG read');return new Uint8Array(await(await env.INPUT.fetch('https://input/?position='+position+'&length='+length)).arrayBuffer());},async close(){closed++;}};},readFile(){throw Error('whole input');},writeFile(){throw Error('whole output');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw Error('unbounded SVG allocation '+length);return Reflect.construct(target,args);}});
 try{const result=await runSipsCli(['-g','pixelWidth','-g','pixelHeight','/input.svg'],{filesystem:fs,cwd:'/',inputBudget:{check(value){admitted=value;}}});return Response.json({...result,closed,admitted,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;}
 }};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
 expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
 let reads=0,furthest=0;
 const runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{INPUT:async(request:Request)=>{const url=new URL(request.url),position=Number(url.searchParams.get("position")),length=Number(url.searchParams.get("length")),bytes=new Uint8Array(length).fill(120);reads++;furthest=Math.max(furthest,position+length);for(const [start,part]of [[0,first],[first.length+padding,last]] as const){const begin=Math.max(position,start),end=Math.min(position+length,start+part.length);if(begin<end)bytes.set(part.subarray(begin-start,end-start),begin-position);}return new Response(bytes);}}});
 try{const response=await runtime.dispatchFetch("https://verify/",{method:"POST",body:JSON.stringify({size})});if(response.status!==200)throw new Error(await response.text());const result=await response.json() as {exitCode:number;stdout:string;closed:number;admitted:number;maxAllocation:number;nodeGlobals:boolean};
 expect(result.exitCode).toBe(0);expect(result.stdout).toContain('pixelWidth: 13');expect(result.stdout).toContain('pixelHeight: 7');expect(result.closed).toBe(1);expect(result.admitted).toBe(size);expect(result.maxAllocation).toBeLessThanOrEqual(65536);expect(result.nodeGlobals).toBe(false);
 expect(reads).toBeLessThanOrEqual(Math.ceil(headerLength/4096)+16);expect(furthest).toBeLessThanOrEqual(Math.ceil(headerLength/4096)*4096);
 }finally{await runtime.dispose();}
},15000);
