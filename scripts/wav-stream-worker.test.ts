import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    export {createFfprobeCommand} from 'safe-bash-command-ffprobe';
    export {createCommandArguments} from 'safe-bash-contracts/command';
    export {MemoryFileSystem} from '@poe-code/safe-fs/core';
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith("node:"))).toBe(false);
  runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const params=new URL(request.url).searchParams, route=params.get('route'), mode=params.get('mode');
      const payload=32*1024*1024, head=new Uint8Array(44), zero=new Uint8Array(16384), view=new DataView(head.buffer);
      for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])head.set(new TextEncoder().encode(text),offset);
      view.setUint32(4,payload+36,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
      view.setUint32(24,8000,true);view.setUint32(28,32000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,payload,true);
      if(mode==='read-failure')head.fill(0,0,4);
      const base=new api.MemoryFileSystem(), controller=new AbortController();
      let closed=false, reads=0, output='', diagnostic='', admitted=0;
      async function* source(){try{
        reads++;yield head;
        if(mode==='read-failure')throw new Error('late read failure');
        for(let offset=0;offset<payload;offset+=zero.length){
          if(mode==='cancel')controller.abort(new Error('cancelled stream'));
          reads++;yield zero;
        }
      }finally{closed=true;}}
      const capabilities={...base.capabilities,retainedRead:false,streamingRead:true};
      const fs=new Proxy(base,{get(target,key){
        if(key==='capabilities')return capabilities;
        if(key==='capabilitiesFor')return async()=>capabilities;
        if(key==='openReadFile')return undefined;
        if(['readFile','open','writeFile'].includes(key))return()=>{throw new Error('Whole-file or spill access forbidden');};
        if(key==='readStream')return()=>source();
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Original=globalThis.Uint8Array;
      globalThis.Uint8Array=new Proxy(Original,{construct(target,args){
        if(typeof args[0]==='number'&&args[0]>65536)throw new Error('Whole-payload allocation forbidden');
        return Reflect.construct(target,args);
      }});
      let result, thrown;
      try{result=await api.createFfprobeCommand({limits:{maxInputBytes:mode==='limit'?1024:payload+44}}).execute({
        command:'ffprobe',...api.createCommandArguments(['-f','wav','-of','json','-show_entries','stream=duration,nb_frames',route==='stdin'?'-':'/input.wav']),
        cwd:'/',env:{},fs,signal:controller.signal,inputBudget:{maxBytes:payload+44,check(value){admitted=value;}},
        stdin:route==='stdin'?source():{async *[Symbol.asyncIterator](){throw new Error('Unexpected stdin');}},
        stdout:{async write(chunk){if(!closed)throw new Error('Input not closed');if(mode==='sink')throw Object.assign(new Error('sink failed'),{code:'EPIPE'});output+=new TextDecoder().decode(chunk);}},
        stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}
      });}catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Original;}
      return Response.json({code:result?.exitCode,thrown,closed,reads,output,diagnostic,admitted,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });

for (const route of ["stdin", "file"]) for (const mode of ["success", "limit", "read-failure", "cancel", "sink"]) {
  it(`streams WAV ${route} metadata in a Node-free Worker: ${mode}`, async () => {
    const response = await runtime.dispatchFetch(`http://worker/?route=${route}&mode=${mode}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { code?: number; thrown?: { message: string; code?: string }; closed: boolean; reads: number; output: string; diagnostic: string; admitted: number; nodeFree: boolean };
    expect(result.nodeFree).toBe(true); expect(result.closed).toBe(true);
    if (mode === "success") {
      expect(result.code, result.diagnostic).toBe(0); expect(result.reads).toBe(2049); expect(result.admitted).toBe(32 * 1024 * 1024 + 44);
      expect(JSON.parse(result.output)).toEqual({ streams: [{ duration: "1048.576000", nb_frames: "8192" }] });
    } else {
      expect(result.output).toBe("");
      if (mode === "limit") { expect(result.code).toBe(1); expect(result.reads).toBe(2); }
      if (mode === "read-failure") { expect(result.code).toBe(1); expect(result.diagnostic).toContain("late read failure"); }
      if (mode === "cancel") { expect(result.thrown?.message).toBe("cancelled stream"); expect(result.reads).toBe(2); }
      if (mode === "sink") expect(result.thrown?.code).toBe("EPIPE");
    }
  });
}
