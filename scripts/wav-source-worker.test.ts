import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("probes a large WAV source with bounded reads in a Node-free Worker", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `export {probeWavSource} from '@poe-code/mp4-ast'; export {createFfprobeCommand} from 'safe-bash-command-ffprobe'; export {createCommandArguments} from 'safe-bash-contracts/command'; export {MemoryFileSystem} from '@poe-code/safe-fs/core';` },
    bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true
  });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith("node:"))).toBe(false);
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(){
      const size=512*1024*1024+44, bytes=new Uint8Array(44), view=new DataView(bytes.buffer);
      for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(text),offset);
      view.setUint32(4,size-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
      view.setUint32(24,8000,true);view.setUint32(28,32000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,size-44,true);
      let reads=0, largest=0;
      const result=await api.probeWavSource({size,async read(offset,length){
        reads++;largest=Math.max(largest,length);
        if(offset+length>44)throw new Error('Payload read');
        return bytes.slice(offset,offset+length);
      }});
      const base=new api.MemoryFileSystem(); await base.writeFile('/input.wav',bytes);
      let closes=0, commandReads=0, output='', diagnostic='';
      const fs=new Proxy(base,{get(target,key){
        if(key==='readFile')return async()=>{throw new Error('Whole file read forbidden');};
        if(key==='openReadFile')return async()=>({stat:async()=>({...await base.stat('/input.wav'),size}),
          async read(offset,length){commandReads++;if(length>16||offset+length>44)throw new Error('Payload read');return bytes.slice(offset,offset+length);},
          async close(){closes++;}});
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const command=await api.createFfprobeCommand({limits:{maxInputBytes:size}}).execute({command:'ffprobe',...api.createCommandArguments(['-f','wav','-of','json','-show_entries','stream=duration,nb_frames','/input.wav']),
        cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},
        stdout:{async write(chunk){output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});
      return Response.json({result,reads,largest,commandReads,closes,code:command.exitCode,output,diagnostic,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
  try {
    const response = await runtime.dispatchFetch("http://worker/");
    expect(response.status).toBe(200);
    const actual = await response.json() as { result: { streams: { duration: string; nb_frames: string }[] }; reads: number; largest: number; nodeFree: boolean; commandReads: number; closes: number; code: number; output: string; diagnostic: string };
    expect(actual.nodeFree).toBe(true); expect(actual.reads).toBe(4); expect(actual.largest).toBe(16);
    expect(actual.code, actual.diagnostic).toBe(0); expect(actual.commandReads).toBe(4); expect(actual.closes).toBe(1);
    expect(JSON.parse(actual.output)).toEqual({ streams: [{ duration: "16777.216000", nb_frames: "131072" }] });
    expect(actual.result.streams[0]).toMatchObject({ duration: "16777.216000", nb_frames: "131072" });
  } finally { await runtime.dispose(); }
});
