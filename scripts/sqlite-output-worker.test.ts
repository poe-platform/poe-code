import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';

it.each(['dump','limit','cancel','pipe'])('streams SQLite dumps through external Worker backing (%s)',async mode=>{
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
  const text="é😀'".repeat(170000),blob=new Uint8Array(1048577);for(let i=0;i<blob.length;i++)blob[i]=i%251;
  const engine={executeStatement(){return null;},tables:new Map([['t',{name:'t',sql:'CREATE TABLE t(x)',columns:[{name:'x'}],rows:[{data:{x:text}},{data:{x:blob}}]}]])};
  let largestAllocation=0,largestWrite=0,total=0,hash=2166136261,diagnostic='',cancelled=false,result;
  const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded typed allocation');return value;}});
  try{result=await api.createSqlite3Command({engine,limits:mode==='limit'?{maxOutputBytes:100000}:{}}).execute({command:'sqlite3',...api.createCommandArguments([':memory:','.dump']),cwd:'/spill',env:{},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){}},
   stdout:{async write(bytes){largestWrite=Math.max(largestWrite,bytes.length);total+=bytes.length;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;if(mode==='cancel')controller.abort(reason);if(mode==='pipe')throw reason;}},
   stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(error){if(error!==reason)throw error;cancelled=true;}
  return Response.json({code:result?.exitCode,cancelled,total,hash,largestWrite,largestAllocation,events,remaining:(await env.PAGES.list()).objects.length,diagnostic,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
 }};`});
 try{
  const response=await runtime.dispatchFetch(`http://worker/${mode}`);expect(response.status).toBe(200);
  const result=await response.json() as {code?:number;cancelled:boolean;total:number;hash:number;largestWrite:number;largestAllocation:number;events:{opened:number;closed:number;largestTransfer:number};remaining:number;diagnostic:string;nodeFree:boolean};
  expect(result.nodeFree).toBe(true);expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);
  expect(result.largestWrite).toBeLessThanOrEqual(16384);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);
  if(mode==='dump'){
   const blob=Uint8Array.from({length:1048577},(_,i)=>i%251);
   const expected=new TextEncoder().encode("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE t(x);\nINSERT INTO t VALUES('"+"é😀''".repeat(170000)+"');\nINSERT INTO t VALUES(X'"+Buffer.from(blob).toString('hex').toUpperCase()+"');\nCOMMIT;\n");
   let hash=2166136261;for(const byte of expected)hash=Math.imul(hash^byte,16777619)>>>0;
   expect(result.code).toBe(0);expect(result.total).toBe(expected.length);expect(result.hash).toBe(hash);
  }else if(mode==='cancel')expect(result.cancelled).toBe(true);
  else{expect(result.code).toBe(1);expect(result.diagnostic).toContain(mode==='limit'?'maxOutputBytes':'stopped');if(mode==='limit')expect(result.total).toBe(0);}
 }finally{await runtime.dispose();}
},60000);
