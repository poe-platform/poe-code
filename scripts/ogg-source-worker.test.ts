import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { encodeOgg } from "../packages/audio-ast/src/ogg.js";

const page = encodeOgg([{ data: new Uint8Array(65024).fill(23), serial: 17, granule: 48000n, bos: true, eos: true }]);
const prefix = Array.from(page.subarray(0, 282));
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: "export { scanOggPages } from '@poe-code/audio-ast';" }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith("node:"))).toBe(false);
  runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const [kind,mode]=new URL(request.url).pathname.slice(1).split('/');
      const prefix=new Uint8Array(${JSON.stringify(prefix)}),size=${page.length}*40,controller=new AbortController();
      let reads=0,closed=0,pages=0,checkpoints=0,largestRead=0,largestAllocation=0,error;
      function read(offset,length){
        reads++;largestRead=Math.max(largestRead,length);
        if(reads===4&&mode==='source')throw new Error('source failure');
        if(reads===4&&mode==='cancel')controller.abort(new Error('cancelled read'));
        const bytes=new Uint8Array(length);
        for(let i=0;i<length;i++){const at=(offset+i)%${page.length};bytes[i]=at<prefix.length?prefix[at]:23;}
        if(mode==='crc'&&offset<1000&&offset+length>1000)bytes[1000-offset]^=1;
        return bytes;
      }
      const retained={size,async read(offset,length){return read(offset,length);}};
      const sequential={async *[Symbol.asyncIterator](){try{for(let at=0;at<size;at+=8192)yield read(at,Math.min(8192,size-at));if(mode==='late')throw new Error('late source');}finally{closed++;}}};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>16384)throw new Error('Unbounded allocation');return bytes;}});
      try{for await(const page of api.scanOggPages(kind==='retained'?retained:sequential,{signal:controller.signal,async checkpoint(){checkpoints++;if(mode==='checkpoint')throw new Error('checkpoint failure');}})){pages++;if(page.size!==${page.length}||page.serial!==17||page.granule!==48000n)throw new Error('Wrong page');if(mode==='return')break;}}
      catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({reads,closed,pages,checkpoints,largestRead,largestAllocation,error});
    }}
  ` });
});
afterAll(async () => { await runtime?.dispose(); });
for (const kind of ["retained", "stream"]) {
  for (const mode of ["ok", "source", "cancel", "crc", "checkpoint", "return", ...(kind === "stream" ? ["late"] : [])]) {
    it(`validates bounded Ogg ${kind}/${mode} in a Node-free Worker`, async () => {
      const result = await (await runtime.dispatchFetch(`https://example.test/${kind}/${mode}`)).json() as {
        pages: number; closed: number; largestRead: number; largestAllocation: number; checkpoints: number; error?: string
      };
      expect(result.largestRead).toBeLessThanOrEqual(16384);
      expect(result.largestAllocation).toBeLessThanOrEqual(16384);
      expect(result.closed).toBe(kind === "stream" ? 1 : 0);
      if (mode === "ok" || mode === "return") {
        expect(result.error).toBeUndefined();
        expect(result.pages).toBe(mode === "ok" ? 40 : 1);
        expect(result.checkpoints).toBeGreaterThan(0);
      } else {
        expect(result.error).toBe({ source: "source failure", cancel: "cancelled read", crc: "Ogg checksum mismatch", checkpoint: "checkpoint failure", late: "late source" }[mode]);
        expect(result.pages).toBe(mode === "late" ? 40 : 0);
      }
    });
  }
}
