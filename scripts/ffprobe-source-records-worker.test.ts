import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

const count=12000, length=16+20+count*16, input=new Uint8Array(length),view=new DataView(input.buffer);
view.setUint32(0,16);input.set(new TextEncoder().encode('tfhd'),4);view.setUint32(12,9);
view.setUint32(16,20+count*16);input.set(new TextEncoder().encode('trun'),20);view.setUint32(24,0x01000f01);view.setUint32(28,count);view.setUint32(32,1000000);
for(let i=0;i<count;i++){const at=36+i*16;view.setUint32(at,2);view.setUint32(at+4,3);view.setUint32(at+8,i%2?0x01010000:0x02000000);view.setInt32(at+12,-1);}
const expected=new TextEncoder().encode(JSON.stringify({packets:Array.from({length:count},(_,i)=>({codec_type:'video',stream_index:0,pts:i*2-1,pts_time:((i*2-1)/1000).toFixed(6),dts:i*2,dts_time:(i*2/1000).toFixed(6),duration:2,duration_time:'0.002000',size:'3',pos:String(1000000+i*3),flags:i%2===0?'K_':'__'}))})+'\n');
let expectedHash=2166136261;for(const byte of expected)expectedHash=Math.imul(expectedHash^byte,16777619)>>>0;
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`export {createFfprobeCommand} from 'safe-bash-command-ffprobe';export {mp4Ast,scanMp4Fragment} from '@poe-code/mp4-ast';export {createCommandArguments} from 'safe-bash-contracts/command';export {MemoryFileSystem} from '@poe-code/safe-fs/core';export {createR2PagedFixture} from './scripts/pandoc-r2-storage.fixture.mjs';`},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');await namespace.writeFile('/input.mp4',new Uint8Array());
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();let inputClosed=0,pluginClosed=0,retired=0,count=0,total=0,hash=2166136261,largest=0,diagnostic='',error;
      const fs=new Proxy(backing.fs,{get(target,key){
        if(key==='openReadFile')return async()=>({stat:async()=>({...await namespace.stat('/input.mp4'),size:1036000}),async read(offset,length){
          if(inputClosed)throw new Error('premature input close');if(length>16384||offset+length>${length})throw new Error('unbounded input');
          if(count&&mode==='source')throw new Error('late source read');
          const object=await env.PAGES.get('input',{range:{offset,length}});return new Uint8Array(await object.arrayBuffer());
        },async close(){inputClosed++;}});
        if(key==='open')return async(...args)=>{const handle=await target.open(...args);return new Proxy(handle,{get(resource,name){
          if(name==='write')return async(...values)=>{if(mode==='write')throw new Error('backing write failed');if(mode==='cancel')controller.abort(new Error('cancelled records'));return resource.write(...values);};
          const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;
        }});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const plugin={...api.mp4Ast(),async probeRecords(source,options){return {format:{},streams:[],chapters:[],packets:(async function*(){try{for await(const sample of api.scanMp4Fragment(source,{offset:0,length:${length}},{trackId:9,moofOffset:0,type:'video',defaults:{defaultSampleDescriptionIndex:1,defaultSampleDuration:0,defaultSampleSize:0,defaultSampleFlags:0},signal:options.signal})){count++;yield {codec_type:'video',stream_index:0,pts:sample.pts,pts_time:(sample.pts/1000).toFixed(6),dts:sample.dts,dts_time:(sample.dts/1000).toFixed(6),duration:sample.duration,duration_time:(sample.duration/1000).toFixed(6),size:String(sample.size),pos:String(sample.offset),flags:sample.isKeyframe?'K_':'__'};}}finally{retired++;}})(),async close(){pluginClosed++;if(mode==='close')throw new Error('plugin close failed');}};}};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largest=Math.max(largest,bytes.length);if(bytes.length>65536)throw new Error('unbounded allocation');return bytes;}});
      let result;try{result=await api.createFfprobeCommand({asts:[plugin],limits:{maxInputBytes:2000000,maxOutputBytes:4000000}}).execute({command:'ffprobe',...api.createCommandArguments(['-f','mp4','-of','json:compact=1','-show_packets','/input.mp4']),cwd:'/',env:{TMPDIR:'/spill'},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){if(inputClosed!==1||pluginClosed!==1||retired!==1)throw new Error('publication before cleanup');if(bytes.length>16384)throw new Error('unbounded output');for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;total+=bytes.length;}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({exitCode:result?.exitCode,inputClosed,pluginClosed,retired,count,total,hash,largest,diagnostic,error,events:backing.events,remaining:(await env.PAGES.list()).objects.filter(o=>o.key!=='input').length});
    }}
  `});
  await(await runtime.getR2Bucket('PAGES')).put('input',input);
});
afterAll(async()=>{await runtime?.dispose();});
for(const mode of ['success','source','write','close','cancel'])it(`consumes lazy fragment records through the ffprobe command with R2: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/'+mode)).json() as {exitCode?:number;inputClosed:number;pluginClosed:number;retired:number;count:number;total:number;hash:number;largest:number;diagnostic:string;error?:string;events:{opened:number;closed:number;largestTransfer:number};remaining:number};
  expect(result.inputClosed).toBe(1);expect(result.pluginClosed).toBe(1);expect(result.retired).toBe(1);expect(result.largest).toBeLessThanOrEqual(65536);expect(result.events.opened).toBe(result.events.closed);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.remaining).toBe(0);
  if(mode==='success'){expect(result.exitCode,result.diagnostic).toBe(0);expect(result.count).toBe(count);expect([result.total,result.hash]).toEqual([expected.length,expectedHash]);}
  else {expect(result.total).toBe(0);if(mode==='cancel')expect(result.error).toBe('cancelled records');else expect(result.diagnostic).toContain(mode==='source'?'late source read':mode==='write'?'backing write failed':'plugin close failed');}
});
