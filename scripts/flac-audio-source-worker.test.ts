import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

const ranges: [number, number[]][] = [];
const put = (offset: number, bytes: Uint8Array) => ranges.push([offset, [...bytes]]);
const u32 = (value: number, little = false) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, little); return bytes; };
const block = (type: number, length: number) => Uint8Array.of(type, length >>> 16, length >>> 8 & 255, length & 255);
put(0, new TextEncoder().encode("fLaC")); put(4, block(0, 34));
const info = new Uint8Array(34); new DataView(info.buffer).setBigUint64(10, (48000n << 44n) | (1n << 41n) | (23n << 36n) | 96000n); put(8, info);
const vendor = 200000, comment = 4000000, commentSize = 4 + vendor + 4 + 4 + comment;
put(42, block(4, commentSize)); put(46, u32(vendor, true)); put(50 + vendor, u32(1, true)); put(54 + vendor, u32(comment, true));
const pictureAt = 46 + commentSize, description = 200000, picture = 8000000, pictureSize = 8 + 10 + 4 + description + 20 + picture;
put(pictureAt, block(128 | 6, pictureSize)); put(pictureAt + 4, new Uint8Array([0, 0, 0, 3, 0, 0, 0, 10]));
put(pictureAt + 22, u32(description));
const fields = new Uint8Array(20); fields.set(u32(picture), 16); put(pictureAt + 26 + description, fields);
const size = 1024 * 1024 * 1024;
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: "export { probeFlacSource } from '@poe-code/audio-ast';" }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith("node:"))).toBe(false);
  runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const mode=new URL(request.url).pathname.slice(1),ranges=new Map(${JSON.stringify(ranges)}),controller=new AbortController();
      let largest=0,read=0,callbacks=0,error,result,span;
      const Native=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largest=Math.max(largest,value.length);if(value.length>16384)throw new Error('Unbounded allocation');return value;}});
      try{result=await api.probeFlacSource({size:${size},async read(offset,length){
        read+=length;if(mode==='read'&&offset===42)throw new Error('reader failed');
        const bytes=ranges.get(offset);if(!bytes||bytes.length!==length)throw new Error('Payload read');
        if(mode==='short')return new Uint8Array();
        if(mode==='cancel')controller.abort(new Error('cancelled read'));
        const chunk=new Uint8Array(bytes);if(mode==='malformed'&&offset===${pictureAt + 26 + description})new DataView(chunk.buffer).setUint32(16,${picture - 1});
        return chunk;
      }},{signal:controller.signal,async onComment(value){callbacks++;span=value;if(mode==='callback')throw new Error('index failed');}});
      }catch(reason){error=reason.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({result,error,span,callbacks,read,largest,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};`
  });
});
afterAll(async () => { await runtime?.dispose(); });
for (const mode of ["success", "read", "short", "cancel", "callback", "malformed"]) it(`validates strict FLAC spans in a Node-free Worker: ${mode}`, async () => {
  const response = await runtime.dispatchFetch(`http://worker/${mode}`); expect(response.status).toBe(200);
  const r = await response.json() as { result?: { tags: object; duration: number; bitrate: number; streams: object[] }; error?: string; span?: { block: number; offset: number; length: number }; callbacks: number; read: number; largest: number; nodeFree: boolean };
  expect(r.nodeFree).toBe(true); expect(r.largest).toBeLessThanOrEqual(34); expect(r.read).toBeLessThan(128);
  if (mode === "success") {
    expect(r.error).toBeUndefined(); expect(r.result?.tags).toEqual({}); expect(r.result?.duration).toBe(2); expect(r.result?.bitrate).toBe(size * 4);
    expect(r.result?.streams[0]).toMatchObject({ codec: "flac", sampleRate: 48000, channels: 2, bitsPerSample: 24, samples: 96000 });
    expect(r.callbacks).toBe(1); expect(r.span).toEqual({ block: 42, offset: 58 + vendor, length: comment });
  } else expect(r.error).toBe(({ read: "reader failed", short: "Truncated or invalid audio structure", cancel: "cancelled read", callback: "index failed", malformed: "Trailing FLAC picture bytes" } as Record<string, string>)[mode]);
});
