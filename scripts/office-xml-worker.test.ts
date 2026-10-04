import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it.each([false, true])("indexes shared XML using external Worker backing (cancel=%s)", async cancel => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export { openRetainedXmlDocument } from "@poe-code/office-xml";
    export { MemoryFileSystem } from "@poe-code/safe-fs/core";
    export { createR2PagedFixture } from "./scripts/pandoc-r2-storage.fixture.mjs";
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true });
  expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).filter(path => path.includes("/src/") || path.startsWith("node:"))).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.includes("safe-bash-presentation-engine"))).toBe(false);
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
      const {fs,events}=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      const Native=Uint8Array;let largestAllocation=0,sourceClosed=0,length=0,hash=2166136261,cancelled=false;
      globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;largestAllocation=Math.max(largestAllocation,length);if(length>65536)throw new Error('Unbounded allocation');return Reflect.construct(target,args);}});
      const source=(async function*(){try{const meta=await env.PAGES.head('input');for(let offset=0;offset<meta.size;offset+=16384){
        const part=await env.PAGES.get('input',{range:{offset,length:Math.min(16384,meta.size-offset)},onlyIf:{etagMatches:meta.etag}});
        if(!part?.body)throw new Error('Input identity changed');yield new Uint8Array(await part.arrayBuffer());
      }}finally{sourceClosed++;}})();
      let document;
      try{
        document=await api.openRetainedXmlDocument(source,{workingStorage:{fs,directory:'/spill',cacheBytes:16384},signal:controller.signal});
        for await(const bytes of document.text(document.root)){
          if(bytes.length>16384)throw new Error('Oversized text chunk');
          for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;length+=bytes.length;
          await Promise.resolve();if(new URL(request.url).pathname==='/cancel')controller.abort(new Error('cancel'));
        }
      }catch(error){if(error.code!=='cancelled')throw error;cancelled=true;}
      finally{await document?.close();globalThis.Uint8Array=Native;}
      await env.PAGES.delete('input');
      return Response.json({length,hash,cancelled,sourceClosed,largestAllocation,events,scratch:await namespace.readdir('/spill'),remaining:(await env.PAGES.list({limit:1})).objects.length,hostGlobals:[typeof process,typeof Buffer,typeof require]});
    }};
  ` });
  try {
    const payload = "abcd".repeat(300000), bucket = await runtime.getR2Bucket("PAGES");
    await bucket.put("input", new TextEncoder().encode("<root>" + payload + "</root>"));
    const response = await runtime.dispatchFetch("https://xml.test/" + (cancel ? "cancel" : "read")); expect(response.status).toBe(200);
    const result = await response.json() as { length: number; hash: number; cancelled: boolean; sourceClosed: number; largestAllocation: number; events: { opened: number; closed: number; largestTransfer: number }; scratch: unknown[]; remaining: number; hostGlobals: string[] };
    expect(result.cancelled).toBe(cancel); expect(result.sourceClosed).toBe(1);
    if (!cancel) {
      let hash = 2166136261; for (const byte of new TextEncoder().encode(payload)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      expect(result.hash).toBe(hash); expect(result.length).toBe(payload.length);
    }
    expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.largestAllocation).toBeLessThanOrEqual(65536);
    expect(result.scratch).toEqual([]); expect(result.remaining).toBe(0); expect(result.hostGlobals).toEqual(["undefined", "undefined", "undefined"]);
  } finally { await runtime.dispose(); }
}, 20000);
