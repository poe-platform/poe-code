import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';

it.each(['stdout','split','stdout-cancel','split-cancel','stdout-failure','split-failure'])('streams YQ output in a Worker (%s)',async mode=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
 export {createMikeYqCommand} from "safe-bash-command-yq/mike";
 export {createCommandArguments} from "safe-bash-contracts/command";
 export {MemoryFileSystem} from "@poe-code/safe-fs/core";
 `},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
 expect(Object.keys(bundle.metafile!.inputs).filter(path=>path.includes('/src/')||path.startsWith('node:'))).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
 const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
 export default {async fetch(request,env){
  const mode=new URL(request.url).pathname.slice(1),split=mode.startsWith('split'),namespace=new api.MemoryFileSystem(),controller=new AbortController(),reason=new Error('stopped');
  const text='a'.repeat(4095)+'😀é'.repeat(170000);
  let largestAllocation=0,largestWrite=0,total=0,hash=2166136261,opened=0,closed=0,stopped=false,result,diagnostic='',index=0;
  const write=async bytes=>{largestWrite=Math.max(largestWrite,bytes.length);await env.PAGES.put('output/'+index++,bytes);total+=bytes.length;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;if(mode.endsWith('cancel'))controller.abort(reason);if(mode.endsWith('failure'))throw reason;};
  const fs=new Proxy(namespace,{get(target,key){
   if(key==='writeFile')return ()=>{throw new Error('Whole-file output');};
   if(key==='open')return async(...args)=>{
    const descriptor=await namespace.open(...args);opened++;
    return new Proxy(descriptor,{get(handle,member){
     if(member==='write')return async bytes=>{await write(bytes);return bytes.length;};
     if(member==='close')return async()=>{closed++;await descriptor.close();};
     const value=Reflect.get(handle,member,handle);return typeof value==='function'?value.bind(handle):value;
    }});
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded typed allocation');return value;}});
  try{result=await api.createMikeYqCommand().execute({command:'yq',...api.createCommandArguments(split?['-n','--split-exp','"result"','strenv(TEXT)']:['-n','strenv(TEXT)']),cwd:'/',env:{TEXT:text},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{write},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(error){if(error!==reason)throw error;stopped=true;}
  return Response.json({code:result?.exitCode,stopped,total,hash,largestWrite,largestAllocation,opened,closed,diagnostic,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
 }};`});
 try{
  const response=await runtime.dispatchFetch(`http://worker/${mode}`);expect(response.status).toBe(200);
  const result=await response.json() as {code?:number;stopped:boolean;total:number;hash:number;largestWrite:number;largestAllocation:number;opened:number;closed:number;diagnostic:string;nodeFree:boolean};
  expect(result.nodeFree).toBe(true);expect(result.closed).toBe(result.opened);expect(result.opened).toBe(mode.startsWith('split')?1:0);
  expect(result.largestWrite).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);
  if(!mode.includes('-')){
   const expected=new TextEncoder().encode('a'.repeat(4095)+'😀é'.repeat(170000)+'\n');let hash=2166136261;for(const byte of expected)hash=Math.imul(hash^byte,16777619)>>>0;
   expect(result.code,result.diagnostic).toBe(0);expect(result.total).toBe(expected.length);expect(result.hash).toBe(hash);
  }else expect(result.stopped).toBe(true);
 }finally{await runtime.dispose();}
},60000);
