import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mp3Ast } from "@poe-code/mp4-ast";

const size = 2 * 1024 * 1024;
const header = new Uint8Array(12); header.set([255, 251, 144, 0]);
const bytes = new Uint8Array(size); bytes.set(header);
function golden(filename: string) {
  const probe = mp3Ast().probe(bytes, { filename });
  return JSON.stringify({ streams: probe.streams.map(stream => ({ ...stream, nb_read_frames: stream.nb_frames, nb_read_packets: stream.nb_frames })), format: probe.format }, null, 2) + "\n";
}
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    export {createFfprobeCommand} from 'safe-bash-command-ffprobe';
    export {createCommandArguments} from 'safe-bash-contracts/command';
    export {MemoryFileSystem} from '@poe-code/safe-fs/core';
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith("node:"))).toBe(false);
  runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const [selection,route,mode]=new URL(request.url).pathname.slice(1).split('/'),base=new api.MemoryFileSystem(),controller=new AbortController();
      const header=new Uint8Array(${JSON.stringify([...header])});await base.writeFile('/input.mp3',header);
      let closed=0,read=0,output='',diagnostic='',thrown,largestAllocation=0,admitted=0;
      async function* source(){const chunk=new Uint8Array(16384);try{yield header;
        for(let offset=12;offset<${size};offset+=chunk.length){read++;if(mode==='source'&&read===10)throw new Error('reader failed');if(mode==='cancel'&&read===10)controller.abort(new Error('cancelled input'));chunk.fill(read);yield chunk.subarray(0,Math.min(chunk.length,${size}-offset));}
      }finally{closed++;}}
      const capabilities={...base.capabilities,retainedRead:route==='retained',streamingRead:true};
      const fs=new Proxy(base,{get(target,key){
        if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
        if(key==='readFile')return()=>{throw new Error('Whole file forbidden');};if(key==='readStream')return()=>source();
        if(key==='open')return()=>{throw new Error('Unexpected backing');};
        if(key==='openReadFile')return async()=>({stat:async()=>{if(mode==='source')throw new Error('reader failed');if(mode==='cancel')controller.abort(new Error('cancelled input'));return {...await base.stat('/input.mp3'),size:${size}};},
          async read(offset,length){read++;if(offset+length>12)throw new Error('Payload read');if(mode==='source')throw new Error('reader failed');if(mode==='cancel')controller.abort(new Error('cancelled input'));return header.slice(offset,offset+length);},async close(){closed++;}});
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded allocation');return value;}});
      let result;try{result=await api.createFfprobeCommand({limits:{maxInputBytes:mode==='limit'?100000:${size},maxOutputBytes:mode==='output-limit'?30:1000000}}).execute({command:'ffprobe',...api.createCommandArguments([...(selection==='explicit'?['-f','mp3']:[]),'-of','json','-count_packets','-count_frames','-show_streams','-show_format',route==='stdin'?'-':'/input.mp3']),cwd:'/',env:{},fs,signal:controller.signal,inputBudget:{maxBytes:${size},check(total){admitted=total;}},stdin:route==='stdin'?source():{async *[Symbol.asyncIterator](){}},
        stdout:{async write(chunk){if(closed!==1)throw new Error('Input open');if(mode==='sink')throw Object.assign(new Error('pipe failed'),{code:'EPIPE'});output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}
      });}catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Native;}
      return Response.json({code:result?.exitCode,thrown,output,diagnostic,read,closed,admitted,largestAllocation,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });
for (const selection of ["explicit", "automatic"]) for (const route of ["retained", "stream", "stdin"]) for (const mode of ["success", "limit", "output-limit", "cancel", "source", "sink"]) {
  it(`probes ${selection} MP3 in a Node-free Worker via ${route}: ${mode}`, async () => {
    const response = await runtime.dispatchFetch(`http://worker/${selection}/${route}/${mode}`); expect(response.status).toBe(200);
    const r = await response.json() as { code?: number; thrown?: { message: string; code?: string }; output: string; diagnostic: string; read: number; closed: number; admitted: number; largestAllocation: number; nodeFree: boolean };
    expect(r.nodeFree).toBe(true); expect(r.closed).toBe(1); expect(r.largestAllocation).toBeLessThanOrEqual(65536);
    if (mode === "success") { expect(r.code, r.diagnostic).toBe(0); expect(r.output).toBe(golden(route === "stdin" ? "-" : "/input.mp3")); expect(r.admitted).toBe(size); if (route === "retained") expect(r.read).toBe(selection === "explicit" ? 0 : 1); }
    else {
      expect(r.output).toBe("");
      if (mode === "cancel") expect(r.thrown?.message).toBe("cancelled input");
      else if (mode === "sink") expect(r.thrown?.code).toBe("EPIPE");
      else { expect(r.code).toBe(1); expect(r.diagnostic).toContain(mode === "limit" ? "maxInputBytes" : mode === "output-limit" ? "maxOutputBytes" : "reader failed"); }
    }
  });
}
