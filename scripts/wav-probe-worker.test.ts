import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect,it} from 'vitest';

it('ffprobe does not decode WAV PCM channels in a Node-free Worker', async () => {
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
 export {createFfprobeCommand} from 'safe-bash-command-ffprobe';
 export {createCommandArguments} from 'safe-bash-contracts/command';
 export {MemoryFileSystem} from '@poe-code/safe-fs/core';
 `},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true});
 for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);
 expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:`
 const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
 export default {async fetch(){
  const bytes=new Uint8Array(44+4194304),view=new DataView(bytes.buffer),encoder=new TextEncoder();
  for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(encoder.encode(text),offset);
  view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
  view.setUint32(24,8000,true);view.setUint32(28,32000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,bytes.length-44,true);
  const namespace=new api.MemoryFileSystem();let reads=0,output='',diagnostic='';
  const fs=new Proxy(namespace,{get(target,key){if(key==='readFile')return async path=>{if(path!=='/input.wav')throw new Error('Unexpected file');reads++;return bytes;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  globalThis.Float32Array=new Proxy(globalThis.Float32Array,{construct(){throw new Error('Unexpected PCM channel decoding');}});
  const result=await api.createFfprobeCommand().execute({command:'ffprobe',...api.createCommandArguments(['-of','json','-show_entries','stream=sample_rate,channels,duration','/input.wav']),cwd:'/',env:{},fs,signal:new AbortController().signal,
   stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(chunk){output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});
  return Response.json({code:result.exitCode,output,diagnostic,reads,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
 }};`});
 try{
  const response=await runtime.dispatchFetch('http://worker/');expect(response.status).toBe(200);
  const result=await response.json() as {code:number;output:string;diagnostic:string;reads:number;nodeFree:boolean};
  expect(result.code,result.diagnostic).toBe(0);expect(result.reads).toBe(1);expect(result.nodeFree).toBe(true);
  expect(JSON.parse(result.output)).toEqual({streams:[{sample_rate:'8000',channels:2,duration:'131.072000'}]});
 }finally{await runtime.dispose();}
});
