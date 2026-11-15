import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const bytes = readFileSync(new URL("./fixtures/flac-probe/noise.flac", import.meta.url));
const size = bytes.length;
const header = new Uint8Array(42); header.set([102, 76, 97, 67, 128, 0, 0, 34]);
new DataView(header.buffer).setBigUint64(18, (48000n << 44n) | (1n << 41n) | (15n << 36n) | 96000n);
const reference = readFileSync(new URL("./fixtures/flac-probe/native.json", import.meta.url), "utf8");
// JSON member order is immaterial; retain native whitespace and field order within each section.
function sections(json: string) {
  return json.slice(2, -3).split('\n    "').map((section, index) => {
    const value = index === 0 ? section.slice(5) : section;
    return value.endsWith(",") ? value.slice(0, -1) : value;
  }).sort();
}
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    export {probeFlacSource} from '@poe-code/audio-ast';
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
      const header=new Uint8Array(${JSON.stringify([...header])}),encoded=Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0));const metadata=mode==='metadata';if(mode==='malformed')encoded[42]=5;await base.writeFile('/input.flac',header);
      let closed=0,read=0,output='',diagnostic='',thrown,largestAllocation=0,admitted=0;
      async function* source(){const chunk=new Uint8Array(16384);try{
        for(let offset=0;offset<encoded.length;offset+=16384){read++;if(mode==='source'&&read===10)throw new Error('reader failed');if(mode==='cancel'&&read===10)controller.abort(new Error('cancelled input'));const length=Math.min(chunk.length,encoded.length-offset);chunk.set(encoded.subarray(offset,offset+length));yield chunk.subarray(0,length);}
      }finally{closed++;}}
      const capabilities={...base.capabilities,retainedRead:route==='retained',streamingRead:true};
      const fs=new Proxy(base,{get(target,key){
        if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
        if(key==='readFile')return()=>{throw new Error('Whole file forbidden');};if(key==='readStream')return()=>source();
        if(key==='open')return()=>{throw new Error('Unexpected backing');};
        if(key==='openReadFile')return async()=>({stat:async()=>({...await base.stat('/input.flac'),size:${size}}),
          async read(offset,length){read++;if(metadata&&offset+length>42)throw new Error('Payload read');if(length>65536)throw new Error('Unbounded read');if(mode==='source'&&read===10)throw new Error('reader failed');if(mode==='cancel'&&read===10)controller.abort(new Error('cancelled input'));return (metadata?header:encoded).slice(offset,offset+length);},async close(){closed++;}});
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded allocation');return value;}});
      let result;try{if(metadata){const input=await fs.openReadFile('/input.flac');try{const probe=await api.probeFlacSource({size:2*1024*1024,read:input.read});output=JSON.stringify(probe);result={exitCode:0};}finally{await input.close();}}else result=await api.createFfprobeCommand({limits:{maxInputBytes:mode==='limit'?100000:${size},maxOutputBytes:mode==='output-limit'?30:1000000}}).execute({command:'ffprobe',...api.createCommandArguments([...(selection==='explicit'?['-f','flac']:[]),'-of','json','-show_packets','-show_frames','-show_streams','-show_format','-show_entries','packet=pts,dts,duration,size,pos:frame=pts,nb_samples,channels:stream=codec_name,sample_rate,channels,duration:format=filename,format_name,duration,size:stream_disposition=:stream_tags=:format_tags=',route==='stdin'?'-':'/input.flac']),cwd:'/',env:{},fs,signal:controller.signal,inputBudget:{maxBytes:${size},check(total){admitted=total;}},stdin:route==='stdin'?source():{async *[Symbol.asyncIterator](){}},
        stdout:{async write(chunk){if(closed!==1)throw new Error('Input open');if(mode==='sink')throw Object.assign(new Error('pipe failed'),{code:'EPIPE'});output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}
      });}catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Native;}
      return Response.json({code:result?.exitCode,thrown,output,diagnostic,read,closed,admitted,largestAllocation,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });
for (const selection of ["explicit", "automatic"]) for (const route of ["retained", "stream", "stdin"]) for (const mode of ["success", "limit", "output-limit", "cancel", "source", "sink", "malformed"]) {
  it(`probes ${selection} FLAC in a Node-free Worker via ${route}: ${mode}`, async () => {
    const response = await runtime.dispatchFetch(`http://worker/${selection}/${route}/${mode}`); expect(response.status).toBe(200);
    const r = await response.json() as { code?: number; thrown?: { message: string; code?: string }; output: string; diagnostic: string; read: number; closed: number; admitted: number; largestAllocation: number; nodeFree: boolean };
    expect(r.nodeFree).toBe(true); expect(r.closed).toBe(1); expect(r.largestAllocation).toBeLessThanOrEqual(65536);
    if (mode === "success") {
      const expected = reference.replace("scripts/fixtures/flac-probe/noise.flac", route === "stdin" ? "-" : "/input.flac");
      expect(r.code, r.diagnostic).toBe(0);
      expect(JSON.parse(r.output)).toEqual(JSON.parse(expected));
      expect(sections(r.output)).toEqual(sections(expected));
      expect(r.admitted).toBe(size);
      expect(r.read).toBeGreaterThan(2);
    }
    else {
      expect(r.output).toBe("");
      if (mode === "cancel") expect(r.thrown?.message).toBe("cancelled input");
      else if (mode === "sink") expect(r.thrown?.code).toBe("EPIPE");
      else { expect(r.code).toBe(1); expect(r.diagnostic).toContain(mode === "limit" ? "maxInputBytes" : mode === "output-limit" ? "maxOutputBytes" : mode === "malformed" ? "Truncated FLAC CUESHEET" : "reader failed"); }
    }
  });
}

it("probes retained FLAC metadata without reading payload", async () => {
  const response = await runtime.dispatchFetch("http://worker/explicit/retained/metadata");
  const r = await response.json() as { code: number; diagnostic: string; output: string; read: number; closed: number; largestAllocation: number; nodeFree: boolean };
  expect(r.code, r.diagnostic).toBe(0);
  expect(r.nodeFree).toBe(true);
  expect(r.closed).toBe(1);
  expect(r.read).toBeGreaterThan(0);
  expect(r.read).toBeLessThanOrEqual(4);
  expect(r.largestAllocation).toBeLessThanOrEqual(65536);
  const probe = JSON.parse(r.output);
  expect(probe).not.toHaveProperty("packets");
  expect(probe).not.toHaveProperty("frames");
  expect(probe.streams[0]).toMatchObject({ codec: "flac", sampleRate: 48000, channels: 2 });
  expect(probe.duration).toBe(2);
  expect(probe.bitrate).toBe(2 * 1024 * 1024 * 4);
});
