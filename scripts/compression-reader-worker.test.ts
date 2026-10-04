import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';

it('retires an in-flight compression read in a Node-free Worker', async () => {
 const bundle=await build({entryPoints:['packages/compression/dist/index.js'],bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true});
 for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:`
 const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
 export default {async fetch(){
  let release,enter,returned=0;
  const entered=new Promise(resolve=>{enter=resolve;});
  const source={[Symbol.asyncIterator](){return {
   next(){enter();return new Promise(resolve=>{release=resolve;});},
   async return(){returned++;return {done:true};}
  };}};
  const {CodecReader}=api.createCompressionCodec();
  const reader=new CodecReader(source,new AbortController().signal);
  const reading=reader.chunk();await entered;const closing=reader.close();
  release({done:false,value:new Uint8Array([1,2,3])});
  const delivered=await reading;await closing;await reader.close();
  return Response.json({delivered:delivered!==undefined,returned,closedRead:await reader.chunk()===undefined,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
 }};`});
 try {
  const response=await runtime.dispatchFetch('http://worker/');expect(response.status).toBe(200);
  expect(await response.json()).toEqual({delivered:false,returned:1,closedRead:true,nodeFree:true});
 } finally {await runtime.dispose();}
});
