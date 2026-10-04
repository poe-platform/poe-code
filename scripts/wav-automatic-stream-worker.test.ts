import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

const payload = 512 * 1024, size = payload + 44, duration = (payload / 16000).toFixed(6);
const golden = (filename: string) => JSON.stringify({ streams: [{ index: 0, codec_name: "pcm_s16le", codec_type: "audio", sample_rate: "8000", channels: 1, bits_per_sample: 16, duration, bit_rate: "128000" }], format: { filename, nb_streams: 1, format_name: "wav", duration, size: String(size), bit_rate: String(Math.floor(size * 8 / Number(duration))) } }, null, 4) + "\n";
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    export {createFfprobeCommand} from 'safe-bash-command-ffprobe';
    export {createCommandArguments} from 'safe-bash-contracts/command';
    export {MemoryFileSystem} from '@poe-code/safe-fs/core';
    export {createR2PagedFixture} from './scripts/pandoc-r2-storage.fixture.mjs';
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith("node:"))).toBe(false);
  runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const [route,mode]=new URL(request.url).pathname.slice(1).split('/'),namespace=new api.MemoryFileSystem();
      await namespace.mkdir('/spill');const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      let sourceClosed=false,reads=0,output='',diagnostic='',thrown,largestAllocation=0;
      const header=new Uint8Array(44),view=new DataView(header.buffer);
      for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])header.set(new TextEncoder().encode(text),offset);
      view.setUint32(4,${payload + 36},true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
      view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,${payload},true);
      async function* source(){const borrowed=new Uint8Array(16384);try{
        reads++;yield header;
        for(let offset=0;offset<${payload};offset+=borrowed.length){reads++;if(reads===10&&mode==='source')throw new Error('source failed');if(reads===10&&mode==='cancel')controller.abort(new Error('cancelled input'));borrowed.fill(reads);yield borrowed;}
      }finally{sourceClosed=true;}}
      const capabilities={...backing.fs.capabilities,retainedRead:false,streamingRead:true};
      const fs=new Proxy(backing.fs,{get(target,key){
        if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
        if(key==='openReadFile')return undefined;if(key==='readFile')return()=>{throw new Error('Whole file read forbidden');};
        if(key==='readStream')return()=>source();
        if(key==='open')return async(...args)=>{const resource=await target.open(...args);return new Proxy(resource,{get(handle,name){
          if(name==='write')return async(...values)=>{if(mode==='backing-write')throw new Error('backing write failed');return handle.write(...values);};
          if(name==='read')return async(...values)=>{if(mode==='backing-read')throw new Error('backing read failed');return handle.read(...values);};
          if(name==='close')return async(...values)=>{await handle.close(...values);if(mode==='close')throw new Error('backing close failed');};
          const value=Reflect.get(handle,name,handle);return typeof value==='function'?value.bind(handle):value;
        }});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded allocation');return value;}});
      let result;try{result=await api.createFfprobeCommand({limits:{maxInputBytes:mode==='limit'?100000:${size}}}).execute({command:'ffprobe',...api.createCommandArguments(['-of','json','-show_streams','-show_format',route==='stdin'?'-':'/input.wav']),cwd:'/spill',env:{},fs,signal:controller.signal,stdin:route==='stdin'?source():{async *[Symbol.asyncIterator](){}},
        stdout:{async write(chunk){if(!sourceClosed||backing.events.opened!==backing.events.closed)throw new Error('Input still open');if(mode==='sink')throw Object.assign(new Error('pipe failed'),{code:'EPIPE'});output+=new TextDecoder().decode(chunk);}},
        stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}
      });}catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Native;}
      return Response.json({code:result?.exitCode,thrown,output,diagnostic,reads,sourceClosed,largestAllocation,events:backing.events,remaining:(await env.PAGES.list()).objects.length,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });
for (const route of ["stdin", "file"]) for (const mode of ["success", "limit", "cancel", "source", "sink", "backing-write", "backing-read", "close"]) {
  it(`probes automatic WAV from ${route} through external backing: ${mode}`, async () => {
    const response = await runtime.dispatchFetch(`http://worker/${route}/${mode}`); expect(response.status).toBe(200);
    const result = await response.json() as { code?: number; thrown?: { message: string; code?: string }; output: string; diagnostic: string; reads: number; sourceClosed: boolean; largestAllocation: number; events: { opened: number; closed: number; largestTransfer: number }; remaining: number; nodeFree: boolean };
    expect(result.nodeFree).toBe(true); expect(result.sourceClosed).toBe(true); expect(result.events.opened).toBe(1); expect(result.events.closed).toBe(1); expect(result.remaining).toBe(0);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.largestAllocation).toBeLessThanOrEqual(65536);
    if (mode === "success") { expect(result.code, result.diagnostic).toBe(0); expect(result.output).toBe(golden(route === "stdin" ? "-" : "/input.wav")); expect(result.reads).toBe(33); }
    else {
      expect(result.output).toBe("");
      if (mode === "cancel") expect(result.thrown?.message).toBe("cancelled input");
      else if (mode === "sink") expect(result.thrown?.code).toBe("EPIPE");
      else { expect(result.code).toBe(1); expect(result.diagnostic).toContain(mode === "limit" ? "maxInputBytes" : mode === "source" ? "source failed" : mode === "close" ? "backing close failed" : mode === "backing-read" ? "backing read failed" : "backing write failed"); }
    }
  });
}
