import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';

const golden: Record<string, readonly [number, number]> = {
"list": [2748581,945851176],
"csv": [2918586,4187520573],
"column": [5270004,988697626],
"line": [2748596,4109106070],
"json": [2918598,529947478],
"tabs": [2748581,945851176],
"html": [4788638,2495109542],
"markdown": [5270020,995266080],
"box": [14790066,2538001440],
"table": [7650030,2563778560],
"quote": [3967165,1464045126],
"ascii": [2748581,2617875244],
"insert": [3967215,3442980184],
};

it.each([...Object.keys(golden),'limit','cancel','pipe'])('streams SQLite query formatting through external Worker backing (%s)',async mode=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
 export {createSqlite3Command} from "safe-bash-command-sqlite3";
 export {createCommandArguments} from "safe-bash-contracts/command";
 export {MemoryFileSystem} from "@poe-code/safe-fs/core";
 export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
 `},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
 expect(Object.keys(bundle.metafile!.inputs).filter(path=>path.includes('/src/')||path.startsWith('node:'))).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
 const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
 export default {async fetch(request,env){
  const mode=new URL(request.url).pathname.slice(1),namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
  const {fs,events}=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController(),reason=new Error('stopped');
  const text="é😀'\\"<&".repeat(170000),blob=new Uint8Array(1048577).fill(65);
  const engine={executeStatement(){if(mode==='cancel')setTimeout(()=>controller.abort(reason),0);return {columns:['x'],rows:[[text],[blob]]};}};
  let largestAllocation=0,largestWrite=0,total=0,hash=2166136261,diagnostic='',cancelled=false,result;
  const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded typed allocation');return value;}});
  try{result=await api.createSqlite3Command({engine,limits:mode==='limit'?{maxOutputBytes:100000}:{}}).execute({command:'sqlite3',...api.createCommandArguments([':memory:','.headers on','.mode '+(mode==='cancel'?'column':mode==='limit'||mode==='pipe'?'json':mode),'SELECT x FROM t;']),cwd:'/spill',env:{},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){}},
   stdout:{async write(bytes){largestWrite=Math.max(largestWrite,bytes.length);total+=bytes.length;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;if(mode==='pipe')throw reason;}},
   stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(error){if(error!==reason)throw error;cancelled=true;}
  return Response.json({code:result?.exitCode,cancelled,total,hash,largestWrite,largestAllocation,events,remaining:(await env.PAGES.list()).objects.length,diagnostic,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
 }};`});
 try{
  const response=await runtime.dispatchFetch(`http://worker/${mode}`);expect(response.status).toBe(200);
  const result=await response.json() as {code?:number;cancelled:boolean;total:number;hash:number;largestWrite:number;largestAllocation:number;events:{opened:number;closed:number;largestTransfer:number};remaining:number;diagnostic:string;nodeFree:boolean};
  expect(result.nodeFree).toBe(true);if(mode!=='cancel')expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);
  expect(result.largestWrite).toBeLessThanOrEqual(16384);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);
  if(golden[mode]){
   expect(result.code).toBe(0);expect(result.total).toBe(golden[mode]![0]);expect(result.hash).toBe(golden[mode]![1]);
  }else if(mode==='cancel'){expect(result.cancelled).toBe(true);expect(result.total).toBe(0);}
  else{expect(result.code).toBe(1);expect(result.diagnostic).toContain(mode==='limit'?'maxOutputBytes':'stopped');if(mode==='limit')expect(result.total).toBe(0);}
 }finally{await runtime.dispose();}
},60000);
