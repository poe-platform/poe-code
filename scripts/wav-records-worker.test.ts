import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { wavAst } from "@poe-code/mp4-ast";

const payload = 1024 * 1024;
function head() {
  const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, payload + 36, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, payload, true); return bytes;
}
function fingerprint(bytes: Uint8Array) { let hash = 2166136261; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0; return [bytes.length, hash]; }
const bytes = new Uint8Array(payload + 44); bytes.set(head());
const expected = wavAst().probe(bytes, { showPackets: true, showFrames: true });
const golden = Object.fromEntries(["success", "compact"].map(mode => [mode, fingerprint(new TextEncoder().encode(JSON.stringify({ packets: expected.packets, frames: expected.frames }, null, mode === "compact" ? undefined : 2) + "\n"))]));
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
      const [route,mode]=new URL(request.url).pathname.slice(1).split('/'),header=new Uint8Array(${JSON.stringify([...head()])}),namespace=new api.MemoryFileSystem();
      await namespace.mkdir('/spill');await namespace.writeFile('/input.wav',header);
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      let inputClosed=0,total=0,hash=2166136261,largestWrite=0,largestAllocation=0,diagnostic='',thrown;
      async function* source(){const chunk=new Uint8Array(16384);try{yield header;for(let offset=0;offset<${payload};offset+=chunk.length)yield chunk;}finally{inputClosed++;}}
      const capabilities={...backing.fs.capabilities,retainedRead:false,streamingRead:true};
      const fs=new Proxy(backing.fs,{get(target,key){
        if(key==='readFile')return()=>{throw new Error('Whole input forbidden');};
        if(route==='stdin'||route==='file'){
          if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
          if(key==='openReadFile')return undefined;if(key==='readStream')return()=>source();
        }
        if(key==='openReadFile')return async()=>({stat:async()=>({...await namespace.stat('/input.wav'),size:${payload + 44}}),
          async read(offset,length){if(offset+length>44)throw new Error('Payload read');return header.slice(offset,offset+length);},async close(){inputClosed++;}});
        if(key==='open')return async(...args)=>{
          const resource=await target.open(...args);
          return new Proxy(resource,{get(handle,name){
            if(name==='write')return async(...values)=>{if(mode==='backing-write')throw new Error('backing write failed');if(mode==='cancel')controller.abort(new Error('cancelled records'));return handle.write(...values);};
            if(name==='read')return async(...values)=>{if(mode==='backing-read')throw new Error('backing read failed');return handle.read(...values);};
            if(name==='close')return async(...values)=>{await handle.close(...values);if(mode==='close')throw new Error('backing close failed');};
            const value=Reflect.get(handle,name,handle);return typeof value==='function'?value.bind(handle):value;
          }});
        };
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded allocation');return value;}});
      let result;
      try{result=await api.createFfprobeCommand({limits:{maxOutputBytes:mode==='limit'?100000:4000000}}).execute({command:'ffprobe',...api.createCommandArguments([...(route==='explicit'?['-f','wav']:[]),'-of',mode==='compact'?'json=c=1':'json','-show_packets','-show_frames',route==='stdin'?'-':'/input.wav']),cwd:'/spill',env:{},fs,signal:controller.signal,stdin:route==='stdin'?source():{async *[Symbol.asyncIterator](){}},
        stdout:{async write(chunk){if(inputClosed!==1)throw new Error('Input still open');largestWrite=Math.max(largestWrite,chunk.length);if(mode==='sink')throw Object.assign(new Error('pipe failed'),{code:'EPIPE'});total+=chunk.length;for(const byte of chunk)hash=Math.imul(hash^byte,16777619)>>>0;}},
        stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}
      });}catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Native;}
      return Response.json({code:result?.exitCode,thrown,total,hash,largestWrite,largestAllocation,inputClosed,diagnostic,events:backing.events,remaining:(await env.PAGES.list()).objects.length,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });
for (const route of ["explicit", "automatic", "stdin", "file"]) for (const mode of ["success", "compact", "limit", "cancel", "sink", "backing-write", "backing-read", "close"]) {
  it(`streams WAV packet/frame output through external Worker backing from ${route}: ${mode}`, async () => {
    const response = await runtime.dispatchFetch(`http://worker/${route}/${mode}`); expect(response.status).toBe(200);
    const result = await response.json() as { code?: number; thrown?: { message: string; code?: string }; total: number; hash: number; largestWrite: number; largestAllocation: number; inputClosed: number; diagnostic: string; events: { opened: number; closed: number; largestTransfer: number }; remaining: number; nodeFree: boolean };
    expect(result.nodeFree).toBe(true); expect(result.inputClosed).toBe(1); expect(result.events.opened).toBe(1); expect(result.events.closed).toBe(1); expect(result.remaining).toBe(0);
    expect(result.largestWrite).toBeLessThanOrEqual(16384); expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.largestAllocation).toBeLessThanOrEqual(65536);
    if (mode === "success" || mode === "compact") { expect(result.code, result.diagnostic).toBe(0); expect([result.total, result.hash]).toEqual(golden[mode]); }
    else if (mode === "close") { expect(result.code).toBe(1); expect(result.diagnostic).toContain("backing close failed"); expect([result.total, result.hash]).toEqual(golden.success); }
    else {
      expect(result.total).toBe(0);
      if (mode === "cancel") expect(result.thrown?.message).toBe("cancelled records");
      else if (mode === "sink") expect(result.thrown?.code).toBe("EPIPE");
      else { expect(result.code).toBe(1); expect(result.diagnostic).toContain(mode === "limit" ? "maxOutputBytes" : mode === "backing-read" ? "backing read failed" : "backing write failed"); }
    }
  });
}
