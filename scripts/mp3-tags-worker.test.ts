import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { probe } from "../packages/safe-bash-command-ffprobe/src/probe.js";

const encoder = new TextEncoder(), pattern = Uint8Array.of(65,255,0,34,10), repeated = pattern.length * 70000;
const sync = (value: number) => [value >>> 21 & 127,value >>> 14 & 127,value >>> 7 & 127,value & 127];
const frame = (id: string, data: number[]) => [...encoder.encode(id),...sync(data.length),0,0,...data];
const fields = [...frame("TPE2",[2,0,65,0,108,0,98,0,117,0,109,0,32,0,65]),...frame("COMM",[3,101,110,103,0,...encoder.encode('note é😀')])];
for(let i=0;i<1500;i++)fields.push(...frame('T'+i.toString(36).padStart(3,'0'),[3,...encoder.encode('value'+i)]));
const metadata = new Uint8Array(fields), audio = new Uint8Array(417 * 4 + 128);
for(let i=0;i<4;i++)audio.set([255,251,144,0],i*417);
audio.set(encoder.encode('Xing'),36);const view=new DataView(audio.buffer);view.setUint32(40,3);view.setUint32(44,3);view.setUint32(48,2048);
audio.set(encoder.encode('TAGold title'),audio.length-128);audio[audio.length-2]=7;audio[audio.length-1]=13;
const tail = new Uint8Array(metadata.length + audio.length);tail.set(metadata);tail.set(audio,metadata.length);
const prefix=Uint8Array.from([73,68,51,4,0,0,...sync(11+repeated+metadata.length),84,73,84,50,...sync(1+repeated),0,2,0]);
const valueStart=prefix.length,size=valueStart+repeated+tail.length,bytes=new Uint8Array(size);bytes.set(prefix);
for(let i=0;i<repeated;i++)bytes[valueStart+i]=pattern[i%pattern.length]!;bytes.set(tail,valueStart+repeated);
const writers = ["json", "default", "flat", "compact:s=||", "csv:s=||"];
function fingerprint(text: string) { const bytes = new TextEncoder().encode(text); let hash = 2166136261; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0; return [bytes.length, hash]; }
const golden = Object.fromEntries(["retained", "stdin", "stream"].flatMap(route => writers.map(writer => [route + writer, fingerprint(probe(bytes, ["-of", writer, "-show_streams", "-show_format", "-show_entries", "stream:format:stream_tags:format_tags", route === "stdin" ? "-" : "/input.mp3"]))])));
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
      const url=new URL(request.url),route=url.searchParams.get('route'),mode=url.searchParams.get('mode'),writer=url.searchParams.get('writer');
      const prefix=new Uint8Array(${JSON.stringify([...prefix])}),tail=new Uint8Array(${JSON.stringify([...tail])}),pattern=new Uint8Array(${JSON.stringify([...pattern])});
      const namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');await namespace.writeFile('/input.mp3',prefix);
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      let inputClosed=false,starts=0,total=0,hash=2166136261,largestAllocation=0,largestRead=0,diagnostic='',thrown;
      function range(offset,length){largestRead=Math.max(largestRead,length);if(length>16384)throw new Error('Large source read');
        if(offset===${valueStart}){starts++;if(starts===2&&mode==='late-read')throw new Error('late source read failed');if(starts===2&&mode==='cancel')controller.abort(new Error('cancelled tag replay'));}
        const result=new Uint8Array(length);for(let i=0;i<length;i++){const pos=offset+i;if(pos<prefix.length)result[i]=prefix[pos];else if(pos<${valueStart+repeated})result[i]=pattern[(pos-${valueStart})%pattern.length];else result[i]=tail[pos-${valueStart+repeated}];}return result;
      }
      async function* input(){try{for(let offset=0;offset<${size};offset+=16384)yield range(offset,Math.min(16384,${size}-offset));}finally{inputClosed=true;}}
      const capabilities={...backing.fs.capabilities,retainedRead:false,streamingRead:true};
      const fs=new Proxy(backing.fs,{get(target,key){
        if(route==='stream'){
          if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
          if(key==='openReadFile')return undefined;if(key==='readStream')return()=>input();
        }
        if(key==='readFile')return()=>{throw new Error('Whole input forbidden');};
        if(key==='openReadFile')return async()=>({stat:async()=>({...await namespace.stat('/input.mp3'),size:${size}}),read:async(offset,length)=>range(offset,length),close:async()=>{inputClosed=true;}});
        if(key==='open')return async(...args)=>{const resource=await target.open(...args);return new Proxy(resource,{get(handle,name){
          if(name==='write')return async(...values)=>{if(mode==='write')throw new Error('backing write failed');return handle.write(...values);};
          if(name==='read')return async(...values)=>{if(mode==='read')throw new Error('backing read failed');return handle.read(...values);};
          if(name==='close')return async(...values)=>{await handle.close(...values);if(mode==='close')throw new Error('backing close failed');};
          const value=Reflect.get(handle,name,handle);return typeof value==='function'?value.bind(handle):value;
        }});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=globalThis.Uint8Array,stringify=JSON.stringify,upper=String.prototype.toUpperCase;
      globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded allocation');return value;}});
      JSON.stringify=(value,...rest)=>{if(typeof value==='string'&&value.length>32768)throw new Error('Unbounded tag string');return stringify(value,...rest);};
      String.prototype.toUpperCase=function(){if(this.length>32768)throw new Error('Unbounded key string');return upper.call(this);};
      let result;try{result=await api.createFfprobeCommand({limits:{maxInputBytes:${size},maxOutputBytes:mode==='limit'?100000:4000000}}).execute({command:'ffprobe',...api.createCommandArguments(['-of',writer,'-show_streams','-show_format','-show_entries','stream:format:stream_tags:format_tags',route==='stdin'?'-':'/input.mp3']),cwd:'/spill',env:{},fs,signal:controller.signal,stdin:route==='stdin'?input():{async *[Symbol.asyncIterator](){}},
        stdout:{async write(chunk){if(!inputClosed)throw new Error('Input still open');if(mode==='sink')throw Object.assign(new Error('pipe failed'),{code:'EPIPE'});total+=chunk.length;for(const byte of chunk)hash=Math.imul(hash^byte,16777619)>>>0;}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}
      });}catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Native;JSON.stringify=stringify;String.prototype.toUpperCase=upper;}
      return Response.json({code:result?.exitCode,thrown,total,hash,inputClosed,largestRead,largestAllocation,diagnostic,events:backing.events,remaining:(await env.PAGES.list()).objects.length,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });
const cases = [ ...["retained", "stdin", "stream"].flatMap(route => writers.map(writer => ({ route, writer, mode: "success" }))), ...["limit", "late-read", "cancel", "write", "read", "close", "sink"].map(mode => ({ route: "retained", writer: "json", mode })) ];
for (const { route, writer, mode } of cases) it(`bounds strict MP3 metadata, tags and indexes in a Worker: ${route} ${writer} ${mode}`, async () => {
  const response = await runtime.dispatchFetch("http://worker/?" + new URLSearchParams({ route, writer, mode })); expect(response.status).toBe(200);
  const result = await response.json() as { code?: number; thrown?: { message: string; code?: string }; total: number; hash: number; inputClosed: boolean; largestRead: number; largestAllocation: number; diagnostic: string; events: { opened: number; closed: number; largestTransfer: number }; remaining: number; nodeFree: boolean };
  expect(result.nodeFree).toBe(true); expect(result.inputClosed).toBe(true); expect(result.events.closed).toBe(result.events.opened); expect(result.remaining).toBe(0);
  expect(result.largestRead).toBeLessThanOrEqual(16384); expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.largestAllocation).toBeLessThanOrEqual(65536);
  if (mode === "success") { expect(result.code, result.diagnostic).toBe(0); expect([result.total, result.hash]).toEqual(golden[route + writer]); expect(result.events.opened).toBeGreaterThanOrEqual(route === "retained" ? 2 : 3); }
  else { expect(result.total).toBe(0); if (mode === "cancel") expect(result.thrown?.message).toBe("cancelled tag replay"); else if (mode === "sink") expect(result.thrown?.code).toBe("EPIPE"); else { expect(result.code).toBe(1); expect(result.diagnostic).toContain(mode === "limit" ? "maxOutputBytes" : mode === "late-read" ? "late source read failed" : `backing ${mode} failed`); } }
});
