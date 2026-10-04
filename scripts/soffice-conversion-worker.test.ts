import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { PdfDocument, type PdfContentNode } from "@poe-code/pdf-ast";
import { createStoredZipArchive, readZipArchiveEntries } from "safe-bash-command-soffice";

it.each(["copy", "rtf-sdk", "rtf-command", "cancel", "docx-sdk", "docx-command", "docx-cancel", "plain-sdk", "plain-command", "plain-cancel", "docx-plain-sdk", "docx-plain-command", "pdf-sdk", "pdf-command", "pdf-cancel", "pdf-plain-sdk", "odt-sdk", "odt-command", "odt-cancel", "odt-html-sdk", "odt-html-command", "odt-html-cancel", "odt-docx-sdk", "odt-docx-command", "odt-docx-cancel", "odt-pdf-sdk", "odt-pdf-command", "odt-pdf-cancel", "xlsx-sdk", "xlsx-command", "xlsx-cancel", "xlsx-html-sdk", "xlsx-html-command", "xlsx-html-cancel", "xlsx-docx-sdk", "xlsx-docx-command", "xlsx-docx-cancel", "xlsx-pdf-sdk", "xlsx-pdf-command", "xlsx-pdf-cancel", "xlsx-csv-sdk", "xlsx-csv-command", "xlsx-csv-cancel", "xlsx-rewrite-sdk", "xlsx-rewrite-command", "xlsx-rewrite-cancel", "csv-text-sdk", "csv-text-command", "csv-text-cancel", "csv-html-sdk", "csv-html-command", "csv-html-cancel", "csv-docx-sdk", "csv-docx-command", "csv-docx-cancel", "csv-pdf-sdk", "csv-pdf-command", "csv-pdf-cancel", "csv-csv-sdk", "csv-csv-command", "csv-csv-cancel", "csv-rewrite-sdk", "csv-rewrite-command", "csv-rewrite-cancel"])("publishes Soffice conversion through external Worker staging (%s)", async mode => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    export * as soffice from "safe-bash-command-soffice";
    export { createCommandArguments } from "safe-bash-contracts/command";
    export { MemoryFileSystem } from "@poe-code/safe-fs/core";
    export { createR2PagedFixture } from "./scripts/pandoc-r2-storage.fixture.mjs";
  ` }, bundle: true, platform: "browser", conditions: ["workerd"], format: "cjs", write: false, metafile: true, logLevel: "silent" });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => path.includes("/src/") || path.startsWith("node:"))).toEqual([]);
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, r2Buckets: ["PAGES"], script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const rawMode=new URL(request.url).pathname.slice(1),csvInput=rawMode.startsWith('csv-'),mode=csvInput?rawMode.replace('csv-','xlsx-'):rawMode,copy=mode==='copy',xlsx=mode.startsWith('xlsx-'),xlsxHtml=mode.startsWith('xlsx-html-'),csv=mode.startsWith('xlsx-csv-'),rewrite=mode.startsWith('xlsx-rewrite-'),odt=mode.startsWith('odt-'),odtHtml=mode.startsWith('odt-html-'),plain=mode.includes('plain'),docx=mode.includes('docx'),pdf=mode.includes('pdf'),cancel=mode.endsWith('cancel'),namespace=new api.MemoryFileSystem();
      await namespace.mkdir('/spill');await namespace.mkdir('/out');
      const {fs:backing,events}=api.createR2PagedFixture(namespace,env.PAGES);
      const controller=new AbortController(),reason=new Error('cancelled'),stages=new WeakMap();
      let published,created=0,removed=0,closed=0,largestWrite=0,inputClosed=0,largestAllocation=0;
      const fs=new Proxy(backing,{get(target,key){
        if(key==='readStream')return async function*(path,options){
          if(path!==(copy||plain?'/input.txt':odt?'/input.odt':xlsx?(csvInput?'/input.csv':'/input.xlsx'):'/input.rtf'))throw new Error('Unexpected source');
          const meta=await env.PAGES.head('input');
          try{for(let position=0;position<meta.size;position+=16384){
            options?.signal?.throwIfAborted();const object=await env.PAGES.get('input',{range:{offset:position,length:Math.min(16384,meta.size-position)},onlyIf:{etagMatches:meta.etag}});
            if(!object?.body)throw new Error('Source identity changed');yield new Uint8Array(await object.arrayBuffer());
          }}finally{inputClosed++;}
        };
        if(key==='createStagedFile')return async(...args)=>{
          const receipt=await namespace.createStagedFile(...args),info={receipt,prefix:'output-'+crypto.randomUUID()+'/',count:0,size:0};created++;
          const cleanup={async remove(){removed++;try{await receipt.cleanup.remove();}finally{if(published!==info)for(let index=0;index<info.count;index++)await env.PAGES.delete(info.prefix+index);}},async close(){closed++;await receipt.cleanup.close();}};
          stages.set(cleanup,info);
          return {...receipt,cleanup,writer:{async write(bytes,options){
            options?.signal?.throwIfAborted();if(bytes.length>16384)throw new Error('Oversized publication write');largestWrite=Math.max(largestWrite,bytes.length);
            await env.PAGES.put(info.prefix+info.count++,bytes);info.size+=bytes.length;
            if(cancel)controller.abort(reason);
          },async finish(options){info.sealed=await receipt.writer.finish(options);return {...info.sealed,size:info.size};}}};
        };
        if(key==='publishStagedFile')return async(staging,path,options)=>{
          const info=stages.get(staging.cleanup);if(!info||!info.sealed||staging.file.stat.size!==info.size)throw new Error('Invalid retained publication receipt');
          // Namespace receipts retain zero payload bytes. The committed pointer
          // selects immutable external pages; no file contents enter MemoryFileSystem.
          await namespace.publishStagedFile({...info.receipt,file:{...info.receipt.file,stat:info.sealed}},path,options);published=info;
        };
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;largestAllocation=Math.max(largestAllocation,length);if(length>65536)throw new Error('Unbounded allocation');return Reflect.construct(target,args);}});
      const stdout={async write(bytes){if(bytes.length>65536)throw new Error('Oversized status');}},stderr={async write(bytes){throw new Error(new TextDecoder().decode(bytes));}};
      const args=['--convert-to',rewrite?'xlsx':docx?'docx':pdf?'pdf':csv?'csv':xlsxHtml?'html':copy||xlsx||odt&&!odtHtml?'txt':'html','--outdir','/out',copy||plain?'/input.txt':odt?'/input.odt':xlsx?(csvInput?'/input.csv':'/input.xlsx'):'/input.rtf'];let result,cancelled=false;
      try{
        if(mode.endsWith('command'))result=await api.soffice.createSofficeCommand().execute({command:'soffice',...api.createCommandArguments(args),cwd:'/spill',env:{},fs,signal:controller.signal,stdout,stderr,stdin:(async function*(){})()});
        else result=await api.soffice.runSofficeFileCli(args,{filesystem:fs,cwd:'/spill',signal:controller.signal,stdout,stderr});
      }catch(error){if(!cancel||error!==reason)throw error;cancelled=true;}finally{globalThis.Uint8Array=Native;}
      let length=0,hash=2166136261;
      if(published)for(let index=0;index<published.count;index++){
        const object=await env.PAGES.get(published.prefix+index),bytes=new Uint8Array(await object.arrayBuffer());
        for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;length+=bytes.length;if(!docx&&!pdf&&!rewrite)await env.PAGES.delete(published.prefix+index);
      }
      const outputs=await namespace.readdir('/out');
      for(const entry of outputs)if((await namespace.stat('/out/'+entry.name)).size!==0)throw new Error('Resident output payload');
      await env.PAGES.delete('input');
      return Response.json({publication:docx||pdf||rewrite?published:undefined,result,cancelled,length,hash,created,removed,closed,largestWrite,inputClosed,largestAllocation,events,
        remaining:(await env.PAGES.list({limit:1})).objects.length,scratch:await namespace.readdir('/spill'),outputs,hostGlobals:[typeof process,typeof Buffer,typeof require]});
    }};
  ` });
  try {
    const csvInput = mode.startsWith("csv-");
    if (csvInput) mode = mode.replace("csv-", "xlsx-");
    const payload = "a".repeat(1100000), source = mode === "copy" ? payload : mode.includes("plain") ? "# " + payload + "\n" : "{\\rtf1 " + payload + "\\par }";
    const bucket = await runtime.getR2Bucket("PAGES"); await bucket.put("input", csvInput ? new TextEncoder().encode('"' + payload + '"\r\n') : mode.startsWith("odt-") ? createStoredZipArchive({ "content.xml": new TextEncoder().encode(mode.startsWith("odt-pdf-") ? "<office><table:table><table:table-row><table:table-cell>" + payload + "</table:table-cell></table:table-row></table:table></office>" : "<office><text:" + (mode.startsWith("odt-html-") ? "h" : "p") + ">" + payload + "</text:" + (mode.startsWith("odt-html-") ? "h" : "p") + "></office>") }) : mode.startsWith("xlsx-") ? createStoredZipArchive({ "xl/worksheets/sheet1.xml": new TextEncoder().encode('<worksheet><row><c t="s"><v>0</v></c></row></worksheet>'), "xl/sharedStrings.xml": new TextEncoder().encode("<sst><si><t>" + payload + "</t></si></sst>") }) : new TextEncoder().encode(source));
    const response = await runtime.dispatchFetch("https://soffice.test/" + (csvInput ? mode.replace("xlsx-", "csv-") : mode)); expect(response.status).toBe(200);
    const result = await response.json() as { publication?: { prefix: string; count: number }; result?: { exitCode: number }; cancelled: boolean; length: number; hash: number; created: number; removed: number; closed: number; largestWrite: number; inputClosed: number; largestAllocation: number; events: { opened: number; closed: number; reads: number; writes: number; largestTransfer: number }; remaining: number; scratch: unknown[]; outputs: { name: string }[]; hostGlobals: string[] };
    expect(result.cancelled).toBe(mode.endsWith("cancel"));
    if (mode.endsWith("cancel")) { expect(result.outputs).toEqual([]); expect(result.length).toBe(0); }
    else if (mode.includes("docx") || mode.includes("pdf") || mode.startsWith("xlsx-rewrite-")) {
      expect(result.result?.exitCode).toBe(0);
      expect(result.outputs.map(entry => entry.name)).toEqual([mode.includes("pdf") ? "input.pdf" : mode.startsWith("xlsx-rewrite-") ? "input.xlsx" : "input.docx"]);
      const parts: Uint8Array[] = [];
      for (let index = 0; index < result.publication!.count; index++) {
        const key = result.publication!.prefix + index;
        parts.push(new Uint8Array(await (await bucket.get(key))!.arrayBuffer()));
        await bucket.delete(key);
      }
      const archive = new Uint8Array(result.length); let offset = 0;
      for (const part of parts) { archive.set(part, offset); offset += part.length; }
      if (mode.includes("pdf")) {
        const document = PdfDocument.load(archive);
        expect(document.pageCount).toBe(1);
        const fragments: string[] = [];
        const inspect = (nodes: PdfContentNode[]) => {
          for (const node of nodes) {
            if (node.kind === "graphics-group") inspect(node.ops);
            else if (node.kind === "text-object") for (const command of node.commands) {
              if (command.kind === "show-text" && command.token.kind === "string") fragments.push(new TextDecoder().decode(command.token.bytes));
            }
          }
        };
        inspect(document.getPage(0).getContentAst()); expect(fragments.join("")).toBe(payload);
      } else {
      const entries = readZipArchiveEntries(archive);
      const rewrite = mode.startsWith("xlsx-rewrite-");
      expect(Array.from(entries.keys()).sort()).toEqual((rewrite ? ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"] : ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]).sort());
      expect(new TextDecoder().decode(entries.get(rewrite ? "xl/worksheets/sheet1.xml" : "word/document.xml"))).toContain((rewrite ? "<t>" : "<w:t>") + payload + (rewrite ? "</t>" : "</w:t>"));
      }
      expect((await bucket.list()).objects).toEqual([]);
    }
    else {
      const xlsxHtml = mode.startsWith("xlsx-html-");
      const expected = xlsxHtml ? '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>input</title></head><body>\n<table>\n  <tr><td>' + payload + '</td></tr>\n</table>\n</body></html>\n' : mode === "copy" ? payload : (mode.startsWith("xlsx-") || mode.startsWith("odt-") && !mode.startsWith("odt-html-")) ? payload + "\n" : '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>input</title></head><body>\n<h1>' + payload + '</h1>\n</body></html>\n';
      const bytes = new TextEncoder().encode(expected); let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      expect(result.result?.exitCode).toBe(0); expect(result.length).toBe(bytes.length); expect(result.hash).toBe(hash);
      expect(result.outputs.map(entry => entry.name)).toEqual([xlsxHtml ? "input.html" : mode.startsWith("xlsx-csv-") ? "input.csv" : mode === "copy" || (mode.startsWith("xlsx-") || mode.startsWith("odt-") && !mode.startsWith("odt-html-")) ? "input.txt" : "input.html"]);
    }
    expect(result.created).toBe(1); expect(result.removed).toBe(1); expect(result.closed).toBe(1);
    expect(result.inputClosed).toBe(1); expect(result.largestWrite).toBeLessThanOrEqual(16384); expect(result.largestAllocation).toBeLessThanOrEqual(65536);
    expect(result.events.opened).toBe(!csvInput && (mode.startsWith("xlsx-") || mode.startsWith("odt-")) ? 2 : 1); expect(result.events.closed).toBe(result.events.opened); expect(result.events.reads).toBeGreaterThan(0); expect(result.events.writes).toBeGreaterThan(0);
    expect(result.events.largestTransfer).toBeLessThanOrEqual(16384); expect(result.remaining).toBe(result.publication ? 1 : 0); expect(result.scratch).toEqual([]);
    expect(result.hostGlobals).toEqual(["undefined", "undefined", "undefined"]);
  } finally { await runtime.dispose(); }
}, 20000);
