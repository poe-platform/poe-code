import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it.each(["success", "tail", "cancel", "read-error", "engine-error"])("imports CSV through external Worker backing (%s)", async mode => {
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
      await namespace.mkdir('/spill');await namespace.writeFile('/input',new Uint8Array());
      const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController(),reason=new Error('interrupted');
      let diagnostic='',returned=0,admitted=0,allocation=0,inserted=0,batches=0,largestStatement=0;
      const Native=globalThis.Uint8Array;
      globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);allocation=Math.max(allocation,value.byteLength);if(value.byteLength>65536)throw new Error('Unbounded allocation');return value;}});
      const payload='é😀'.repeat(10),row=new TextEncoder().encode('"'+payload+'",42\\r\\n'),chunk=new Uint8Array(row.length*200);
      for(let i=0;i<200;i++)chunk.set(row,i*row.length);
      const fs=new Proxy(backing,{get(target,key){
        if(key==='readStream')return async function*(){try{for(let i=0;i<100;i++){admitted+=chunk.length;yield chunk;}if(mode==='cancel')controller.abort(reason);if(mode==='read-error')throw reason;}finally{returned++;}};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const engine={findTable(){return {name:'t',columns:[{name:'x'},{name:'y'}],rows:[]};},executeStatement(sql){
        if(admitted!==chunk.length*100)throw new Error('Premature import');
        const prefix='INSERT INTO "t" VALUES ';
        if(!sql.startsWith(prefix))throw new Error('Unexpected SQL');
        largestStatement=Math.max(largestStatement,sql.length);batches++;
        const values=sql.slice(prefix.length).split('), (');
        for(let i=0;i<values.length;i++){const expected=(i===0?'(':'')+"'"+payload+"', '42'"+(i===values.length-1?')':'');if(values[i]!==expected)throw new Error('Value mismatch');}
        if(mode==='engine-error')throw reason;
        inserted+=values.length;return null;
      }};
      let result,cancelled=false;
      try{result=await api.createSqlite3Command({engine}).execute({command:'sqlite3',...api.createCommandArguments([':memory:','.import --csv '+(mode==='tail'?'--skip -501 ':'')+'/input t']),cwd:'/spill',env:{},fs,signal:controller.signal,
        stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){throw new Error('Unexpected stdout');}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}
      catch(error){if(error!==reason)throw error;cancelled=true;}
      return Response.json({code:result?.exitCode,cancelled,inserted,batches,largestStatement,diagnostic,returned,admitted,allocation,events,remaining:(await env.PAGES.list()).objects.length,nodeFree:typeof process==='undefined'&&typeof Buffer==='undefined'});
    }};
  ` });
  try {
    const response = await runtime.dispatchFetch(`http://worker/${mode}`);
    expect(response.status).toBe(200);
    const result = await response.json() as { code?: number; cancelled: boolean; inserted: number; batches: number; largestStatement: number; diagnostic: string; returned: number; admitted: number; allocation: number; events: { opened: number; closed: number; largestTransfer: number }; remaining: number; nodeFree: boolean };
    expect(result.nodeFree).toBe(true); expect(result.returned).toBe(1); expect(result.admitted).toBeGreaterThan(1024 * 1024);
    expect(result.events.opened).toBeGreaterThan(0); expect(result.events.closed).toBe(result.events.opened);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.allocation).toBeLessThanOrEqual(65536);
    expect(result.remaining).toBe(0); expect(result.largestStatement).toBeLessThan(32768);
    if (mode === "success" || mode === "tail") {
      expect(result.code).toBe(0); expect(result.inserted).toBe(mode === "tail" ? 501 : 20000); expect(result.batches).toBe(mode === "tail" ? 2 : 40);
    } else {
      expect(result.inserted).toBe(0);
      if (mode === "cancel") expect(result.cancelled).toBe(true);
      else { expect(result.code).toBe(1); expect(result.diagnostic).toContain("interrupted"); }
    }
  } finally { await runtime.dispose(); }
}, 60000);
