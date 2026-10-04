import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it.each(["success", "cancel", "read-error"])("retains SQLite scripts on external Worker storage (%s)", async mode => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export { createSqlite3Command } from "safe-bash-command-sqlite3";
    export { createCommandArguments } from "safe-bash-contracts/command";
    export { MemoryFileSystem } from "@poe-code/safe-fs/core";
    export { createR2PagedFixture } from "./scripts/pandoc-r2-storage.fixture.mjs";
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => path.includes("/src/") || path.startsWith("node:"))).toEqual([]);
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),namespace=new api.MemoryFileSystem();
      await namespace.mkdir('/spill');
      const {fs,events}=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController(),reason=new Error('interrupted');
      let output=0,diagnostic='',returned=false,admitted=0,allocation=0;
      const Native=globalThis.Uint8Array;
      globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);allocation=Math.max(allocation,value.byteLength);if(value.byteLength>65536)throw new Error('Unbounded allocation');return value;}});
      const payload='é😀'.repeat(600),line=new TextEncoder().encode('.print "'+payload+'"\\r\\n');
      const source={async *[Symbol.asyncIterator](){try{for(let index=0;index<400;index++){admitted+=line.length;yield line;}if(mode==='cancel')controller.abort(reason);if(mode==='read-error')throw reason;}finally{returned=true;}}};
      let result,cancelled=false;
      try{result=await api.createSqlite3Command().execute({command:'sqlite3',...api.createCommandArguments([':memory:']),cwd:'/spill',env:{},fs,signal:controller.signal,stdin:source,
        stdout:{async write(bytes){if(admitted!==line.length*400)throw new Error('Premature execution');const text=new TextDecoder().decode(bytes);if(text!==payload+'\\n')throw new Error('Output mismatch');output+=bytes.length;}},
        stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(error){if(error!==reason)throw error;cancelled=true;}
      const objects=await env.PAGES.list();
      return Response.json({code:result?.exitCode,cancelled,output,expected:new TextEncoder().encode(payload+'\\n').length*400,diagnostic,returned,admitted,allocation,events,remaining:objects.objects.length,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};
  ` });
  try {
    const response = await runtime.dispatchFetch(`http://worker/${mode}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { code?: number; cancelled: boolean; output: number; expected: number; diagnostic: string; returned: boolean; admitted: number; allocation: number; events: { opened: number; closed: number; largestTransfer: number }; remaining: number; nodeFree: boolean };
    expect(result.nodeFree).toBe(true); expect(result.returned).toBe(true);
    expect(result.admitted).toBeGreaterThan(1024 * 1024);
    expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.allocation).toBeLessThanOrEqual(65536);
    expect(result.remaining).toBe(0);
    if (mode === "success") { expect(result.code).toBe(0); expect(result.output).toBe(result.expected); }
    else { expect(result.output).toBe(0); if (mode === "cancel") expect(result.cancelled).toBe(true); else { expect(result.code).toBe(1); expect(result.diagnostic).toContain("interrupted"); } }
  } finally { await runtime.dispose(); }
}, 60000);
