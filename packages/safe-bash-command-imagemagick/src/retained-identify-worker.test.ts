import { PdfDocument } from "@poe-code/pdf-ast";
import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import sharp from "@poe-code/image-ast";
import { runIdentifyCli } from "./index.js";
it.each([{ format: "bmp", streamed: false }, { format: "bmp", streamed: true }, { format: "pdf", streamed: false }, { format: "pdf", streamed: true }])("inspects $format raster statistics in Workerd with external backing, streamed input=$streamed", async ({ format, streamed }) => {
    const pixels = new Uint8Array(601 * 601 * 4);
    let state = 1234567;
    for (let i = 0; i < pixels.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        pixels[i] = state & 255;
    }
    let bytes = await sharp(pixels, { raw: { width: 601, height: 601, channels: 4 } }).toFormat("bmp").toBuffer();
    if (format === "pdf") {
        const doc = PdfDocument.create(), png = await sharp(pixels, { raw: { width: 601, height: 601, channels: 4 } }).png().toBuffer();
        doc.addPage([73, 59]).drawImage(doc.embedPng(png), { x: 0, y: 0, width: 73, height: 59 });
        bytes = doc.save();
    }
    expect(bytes.length).toBeGreaterThan(1048576);
    const expected = await runIdentifyCli(["-verbose", "/input"], new Map([["/input", bytes]]));
    const expectedFormat = await runIdentifyCli(["-format", "%m %wx%h %b %% %[channels] %[mean] %[opaque] %[bit-depth] %[type] %[standard-deviation] %[fx:p{600,600}.r] %[pixel:p{23,7}] %[hex:p{p{0,0}.r*600,500}]", "/input"], new Map([["/input", bytes]]));
    const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../../../", import.meta.url)), sourcefile: "pdf-metadata-worker.ts", contents: `
 import {runIdentifyCli} from './packages/safe-bash-command-imagemagick/src/index.ts';
 export default {async fetch(request,env){const {size,streamed,format}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(path){return {...this.capabilities,retainedRead:path==='/input'?!streamed:true};},async *readStream(path){const file=files.get(path);opened++;try{for(let position=0;position<file.size;position+=16384){reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+Math.min(16384,file.size-position));yield new Uint8Array(await response.arrayBuffer());}}finally{closed++;}},
 async removeFileConditional(path){files.delete(path);removed++;},
 async open(path){const file={id:String(++id),size:0};files.set(path,file);opened++;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return stat(file);},async write(bytes,position){if(bytes.length>16384)throw new Error('large scratch write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+position,{method:'PUT',body:bytes});file.size=Math.max(file.size,position+bytes.length);return bytes.length;},async read(bytes,position){reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await response.arrayBuffer()));return bytes.length;},async close(){closed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});}};},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded identify allocation '+length);return Reflect.construct(target,args);}});
 try{const metadata=format!=='pdf'||!streamed?await runIdentifyCli(['-verbose','/input'],{filesystem:fs,cwd:'/'}):undefined;const formatted=format!=='pdf'||streamed?await runIdentifyCli(['-format','%m %wx%h %b %% %[channels] %[mean] %[opaque] %[bit-depth] %[type] %[standard-deviation] %[fx:p{600,600}.r] %[pixel:p{23,7}] %[hex:p{p{0,0}.r*600,500}]','/input'],{filesystem:fs,cwd:'/'}):undefined;let outputBytes=0,outputChunks=0;const streamedResult=format!=='pdf'?await runIdentifyCli(['-format','x'.repeat(4095)+'😀'+'é😀'.repeat(5000),'/input'],{filesystem:fs,cwd:'/',stdout:{async write(bytes){if(bytes.length>4096)throw new Error('unbounded identify output');outputBytes+=bytes.length;outputChunks++;}}}):undefined;return Response.json({metadata,formatted,streamedResult,outputBytes,outputChunks,opened,closed,removed,files:files.size,reads,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;}
 }};` }, bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "esm", metafile: true, logLevel: "silent" });
    expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
    const runtime = new Miniflare({ cf: false, workers: [
    { name: "image", modules: true, compatibilityDate: "2026-07-01", script: bundle.outputFiles[0]!.text, serviceBindings: { BACKING: "backing" } },
    { name: "backing", modules: true, compatibilityDate: "2026-07-01", script: `
      const files = new Map();
      export default { async fetch(request) {
        const url = new URL(request.url), key = url.pathname, position = Number(url.searchParams.get('position'));
        if (key === '/') return Response.json([...files.keys()].sort());
        if (request.method === 'DELETE') { files.delete(key); return new Response(); }
        if (request.method === 'PUT') {
          const chunk = new Uint8Array(await request.arrayBuffer()), file = files.get(key) ?? { size: 0, pages: new Map() };
          for (let offset = 0; offset < chunk.length;) {
            const index = Math.floor((position + offset) / 16384), within = (position + offset) % 16384, count = Math.min(chunk.length - offset, 16384 - within);
            let page = file.pages.get(index); if (!page) { page = new Uint8Array(16384); file.pages.set(index, page); }
            page.set(chunk.subarray(offset, offset + count), within); offset += count;
          }
          file.size = Math.max(file.size, position + chunk.length); files.set(key, file); return new Response();
        }
        const file = files.get(key), length = url.searchParams.has('length') ? Number(url.searchParams.get('length')) : file.size - position;
        const bytes = new Uint8Array(Math.max(0, Math.min(length, file.size - position)));
        for (let offset = 0; offset < bytes.length;) {
          const index = Math.floor((position + offset) / 16384), within = (position + offset) % 16384, count = Math.min(bytes.length - offset, 16384 - within), page = file.pages.get(index);
          if (page) bytes.set(page.subarray(within, within + count), offset); offset += count;
        }
        return new Response(bytes);
      } };` }
] });
    try {
        const backing = await runtime.getWorker("backing");
        await backing.fetch("https://backing/input", { method: "PUT", body: bytes });
        const response = await runtime.dispatchFetch("https://image/", { method: "POST", body: JSON.stringify({ size: bytes.length, streamed, format }) });
        if (response.status !== 200)
            throw new Error(await response.text());
        const result = await response.json() as {
            metadata: unknown; formatted: unknown; streamedResult: unknown; outputBytes: number; outputChunks: number;
            opened: number;
            closed: number;
            removed: number;
            files: number;
            reads: number;
            maxAllocation: number;
            nodeGlobals: boolean;
        };
        if (format !== "pdf" || !streamed) expect(result.metadata).toEqual(expected);
        if (format !== "pdf" || streamed) expect(result.formatted).toEqual(expectedFormat);
        expect(result.opened).toBeGreaterThan(1);
        expect(result.closed).toBe(result.opened);
        expect(result.removed).toBe(result.opened - (format === "pdf" ? 1 : 3));
        if (format !== "pdf") {
        expect(result.streamedResult).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(result.outputBytes).toBe(new TextEncoder().encode("x".repeat(4095) + "😀" + "é😀".repeat(5000)).length);
        expect(result.outputChunks).toBeGreaterThan(8);
        }
        expect(result.files).toBe(1);
        expect(result.reads).toBeGreaterThan(8);
        expect(result.maxAllocation).toBeLessThanOrEqual(65536);
        expect(result.nodeGlobals).toBe(false);
        expect(await (await backing.fetch("https://backing/")).json()).toEqual(["/input"]);
    }
    finally {
        await runtime.dispose();
    }
});
