import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';

it.each(['success','cancel','publish'])('retains YQ in-place output in external Worker storage (%s)',async mode=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
 export {createMikeYqCommand} from "safe-bash-command-yq/mike";
 export {createCommandArguments} from "safe-bash-contracts/command";
 export {MemoryFileSystem} from "@poe-code/safe-fs/core";
 export {createR2PagedFixture} from "./scripts/pandoc-r2-storage.fixture.mjs";
 `},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
 expect(Object.keys(bundle.metafile!.inputs).filter(path=>path.includes('/src/')||path.startsWith('node:'))).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
 const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
 export default {async fetch(request,env){
  const mode=new URL(request.url).pathname.slice(1),namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
  await namespace.writeFile('/spill/input.yml',new TextEncoder().encode('a: 1\\n'));
  const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController(),reason=new Error('stopped');
  const text='é😀'.repeat(170000);
  let largestAllocation=0,largestWrite=0,total=0,hash=2166136261,closed=0,removed=0,published=false,stopped=false,result,diagnostic='';
  const fs=new Proxy(backing,{get(target,key){
   if(key==='readStream')return namespace.readStream.bind(namespace);
   if(key==='createStagedFile')return async(...args)=>{
    if(args[2].data.length)throw new Error('Whole-file staging');
    const receipt=await namespace.createStagedFile(...args);let index=0;
    return {...receipt,writer:{async write(bytes){largestWrite=Math.max(largestWrite,bytes.length);await env.PAGES.put('output/'+index++,bytes);total+=bytes.length;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;if(mode==='cancel')controller.abort(reason);},async finish(){return {...await receipt.writer.finish(),size:total};}},
     cleanup:{async remove(){removed++;for(;;){const page=await env.PAGES.list({prefix:'output/',limit:100});if(!page.objects.length)break;await env.PAGES.delete(page.objects.map(object=>object.key));}await receipt.cleanup.remove();},async close(){closed++;await receipt.cleanup.close();}}};
   };
   if(key==='publishStagedFile')return async()=>{if(mode==='publish')throw reason;published=true;};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded typed allocation');return value;}});
  try{result=await api.createMikeYqCommand().execute({command:'yq',...api.createCommandArguments(['-i','strenv(TEXT)','/spill/input.yml']),cwd:'/spill',env:{TEXT:text},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){throw new Error('Unexpected stdout');}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(error){if(error!==reason)throw error;stopped=true;}
  return Response.json({code:result?.exitCode,stopped,total,hash,largestWrite,largestAllocation,events,closed,removed,published,remaining:(await env.PAGES.list()).objects.length,diagnostic,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
 }};`});
 try{
  const response=await runtime.dispatchFetch(`http://worker/${mode}`);expect(response.status).toBe(200);
  const result=await response.json() as {code?:number;stopped:boolean;total:number;hash:number;largestWrite:number;largestAllocation:number;events:{opened:number;closed:number;largestTransfer:number};closed:number;removed:number;published:boolean;remaining:number;diagnostic:string;nodeFree:boolean};
  expect(result.nodeFree).toBe(true);expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);expect(result.closed).toBe(1);expect(result.removed).toBe(1);
  expect(result.largestWrite).toBeLessThanOrEqual(16384);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);
  expect(result.published).toBe(mode==='success');
  if(mode==='success'){
   const expected=new TextEncoder().encode('é😀'.repeat(170000)+'\n');let hash=2166136261;for(const byte of expected)hash=Math.imul(hash^byte,16777619)>>>0;
   expect(result.code,result.diagnostic).toBe(0);expect(result.total).toBe(expected.length);expect(result.hash).toBe(hash);
  }else expect(result.stopped).toBe(true);
 }finally{await runtime.dispose();}
},60000);
