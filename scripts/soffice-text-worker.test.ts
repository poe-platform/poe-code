import { createStoredZipArchive } from "@poe-code/office-package/zip-sync";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it.each(["sdk", "command", "cancel", "rtf-sdk", "rtf-command", "rtf-cancel", "odt-sdk", "odt-command", "odt-cancel", "xlsx-sdk", "xlsx-command", "xlsx-cancel"])("streams Soffice text through external Worker backing (%s)", async mode => {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export * as soffice from "safe-bash-command-soffice";
    export { createCommandArguments } from "safe-bash-contracts/command";
    export { MemoryFileSystem } from "@poe-code/safe-fs/core";
    export { createR2PagedFixture } from "./scripts/pandoc-r2-storage.fixture.mjs";
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent",
    plugins: [{ name: "reject-node-builtins", setup(builder) { builder.onResolve({ filter: /.*/ }, args =>
      builtins.has(args.path) || args.path.startsWith("node:") ? { errors: [{ text: "Forbidden Node import: " + args.path }] } : undefined); } }] });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => path.includes("/src/"))).toEqual([]);
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const variant=new URL(request.url).pathname.slice(1),rtf=variant.startsWith('rtf-'),odt=variant.startsWith('odt-'),xlsx=variant.startsWith('xlsx-'),mode=variant.split('-').at(-1),namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
      const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES);
      let inputClosed=0,inputReads=0,largestInput=0,largestAllocation=0;
      const fs=new Proxy(backing,{get(target,key){
        if(key==='readStream')return async function*(path,options){
          if(path!==(rtf?'/input.rtf':odt?'/input.odt':xlsx?'/input.xlsx':'/input'))throw new Error('Unexpected source');
          const meta=await env.PAGES.head('input');
          try{for(let position=0;position<meta.size;position+=16384){
            options?.signal?.throwIfAborted();
            const object=await env.PAGES.get('input',{range:{offset:position,length:Math.min(16384,meta.size-position)},onlyIf:{etagMatches:meta.etag}});
            if(!object?.body)throw new Error('Source identity changed');
            const bytes=new Uint8Array(await object.arrayBuffer());inputReads++;largestInput=Math.max(largestInput,bytes.length);yield bytes;
          }}finally{inputClosed++;}
        };
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;largestAllocation=Math.max(largestAllocation,length);if(length>65536)throw new Error('Unbounded allocation');return Reflect.construct(target,args);}});
      const controller=new AbortController(),reason=new Error('cancelled');let length=0,largest=0,active=0,peak=0,cancelled=false;
      const stdout={async write(bytes){active++;peak=Math.max(peak,active);try{await scheduler.wait(1);length+=bytes.length;largest=Math.max(largest,bytes.length);for(const byte of bytes)if(byte!==97&&byte!==10)throw new Error('Unexpected output');if(mode==='cancel')controller.abort(reason);}finally{active--;}}};
      const stderr={async write(bytes){throw new Error(new TextDecoder().decode(bytes));}};
      let result;
      try{
        const args=['--cat',rtf?'/input.rtf':odt?'/input.odt':xlsx?'/input.xlsx':'/input'];
        if(mode==='command')result=await api.soffice.createSofficeCommand().execute({command:'soffice',...api.createCommandArguments(args),cwd:'/spill',env:{},fs,signal:controller.signal,stdout,stderr,stdin:(async function*(){})()});
        else result=await api.soffice.runSofficeFileCli(args,{filesystem:fs,cwd:'/spill',signal:controller.signal,stdout,stderr});
      }catch(error){if(mode!=='cancel'||error!==reason)throw error;cancelled=true;}finally{globalThis.Uint8Array=Native;}
      await env.PAGES.delete('input');
      return Response.json({result,cancelled,length,largest,peak,inputClosed,inputReads,largestInput,largestAllocation,events,
        remaining:(await env.PAGES.list({limit:1})).objects.length,namespace:await namespace.readdir('/spill'),hostGlobals:[typeof process,typeof Buffer,typeof require]});
    }};
  ` });
  try {
    const bucket = await runtime.getR2Bucket("PAGES");
    const source = mode.startsWith("rtf-") ? new TextEncoder().encode("{\\rtf1 " + "a".repeat(1100000) + "\\par }") : new Uint8Array(1100000).fill(97);
    await bucket.put("input", mode.startsWith("odt-") ? createStoredZipArchive({
      "content.xml": new TextEncoder().encode("<office><text:p>" + "a".repeat(1100000) + "</text:p></office>")
    }) : mode.startsWith("xlsx-") ? createStoredZipArchive({
      "xl/worksheets/sheet1.xml": new TextEncoder().encode('<worksheet><row><c t="s"><v>0</v></c></row></worksheet>'),
      "xl/sharedStrings.xml": new TextEncoder().encode("<sst><si><t>" + "a".repeat(1100000) + "</t></si></sst>")
    }) : source);
    const response = await runtime.dispatchFetch("https://soffice.test/" + mode);
    expect(response.status).toBe(200);
    const result = await response.json() as { result?: { exitCode: number }; cancelled: boolean; length: number; largest: number; peak: number; inputClosed: number; inputReads: number; largestInput: number; largestAllocation: number; events: { opened: number; closed: number; writes: number; reads: number; largestTransfer: number }; remaining: number; namespace: unknown[]; hostGlobals: string[] };
    expect(result.cancelled).toBe(mode.endsWith("cancel"));
    if (mode.endsWith("cancel")) expect(result.length).toBeLessThan(1100001);
    else { expect(result.result?.exitCode).toBe(0); expect(result.length).toBe(1100001); }
    expect(result.peak).toBe(1); expect(result.largest).toBeLessThanOrEqual(49152);
    expect(result.inputClosed).toBe(1); expect(result.inputReads).toBeGreaterThan(64);
    expect(result.largestInput).toBeLessThanOrEqual(16384); expect(result.largestAllocation).toBeLessThanOrEqual(65536);
    // The small XLSX worksheet fits its bounded cache; only shared strings spill.
    expect(result.events.opened).toBe(mode.startsWith("xlsx-") || mode.startsWith("odt-") ? 2 : 1); expect(result.events.closed).toBe(result.events.opened);
    expect(result.events.reads).toBeGreaterThan(0); expect(result.events.writes).toBeGreaterThan(0);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
    expect(result.remaining).toBe(0); expect(result.namespace).toEqual([]); expect(result.hostGlobals).toEqual(["undefined", "undefined", "undefined"]);
  } finally { await runtime.dispose(); }
}, 15000);
