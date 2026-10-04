import { PdfDocument } from "@poe-code/pdf-ast";
import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { runCompareCli, runConvertCli, runMogrifyCli } from "./index.js";
for (const tool of ["compare", "convert", "mogrify", "convert-write"] as const)
for (const format of (tool === "compare" ? ["bmp", "svg", "label"] : (tool === "mogrify" || tool === "convert-write") ? ["bmp"] : ["bmp", "gradient", "radial-gradient", "pattern", "tile", "pdf"]) as ("bmp" | "svg" | "label" | "gradient" | "radial-gradient" | "pattern" | "tile" | "pdf")[])
for (const stdout of (tool === "mogrify" || tool === "convert-write") ? [false] : [false, true])
    it(`runs ${tool} in Workerd, input=${format}, stdout=${stdout}`, async () => {
        const pixels = new Uint8Array(601 * 601 * 4);
        let state = 1234567;
        for (let i = 0; i < pixels.length; i++) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            pixels[i] = state & 255;
        }
        let bytes = format === "svg" ? new TextEncoder().encode('<svg width="601" height="601">' + " ".repeat(1048576) + '<rect width="601" height="601" fill="red"/><circle cx="300" cy="300" r="70" fill="blue"/></svg>') : await sharp(pixels, { raw: { width: 601, height: 601, channels: 4 } }).toFormat("bmp").toBuffer();
        if (format === "pdf") {
            const doc = PdfDocument.create(), png = await sharp(pixels, { raw: { width: 601, height: 601, channels: 4 } }).png().toBuffer();
            doc.addPage([73, 59]).drawImage(doc.embedPng(png), { x: 0, y: 0, width: 73, height: 59 });
            bytes = doc.save();
        }
        expect(bytes.length).toBeGreaterThan(1048576);
        const generated = ["label", "gradient", "radial-gradient", "pattern", "tile"].includes(format);
        const operand = format === "label" ? "label:" + "x<&😀".repeat(600) : format === "gradient" || format === "radial-gradient" ? format + ":red-blue" : format === "pattern" ? "pattern:checkerboard" : format === "tile" ? "tile:rose:" : "/input";
        const args = format === "bmp" ? ["-size","601x601",operand,"-flip","-gamma","1.4","-colorspace","gray","-modulate","110,90,70","-function","Polynomial","0.5,0.2","-transparent","red","-level","20%,80%,1.3","-negate","-black-threshold","30%","-normalize","-auto-gamma","-crop","590x590+5+5","-background","#ff00ff80","-gravity","center","-extent","601x601","-alpha","shape","-color-matrix","0,1,0 0,0,1 1,0,0","-splice","3x2+4+5","-chop","2x3+5+4","-roll","+103-77","-emboss","1","-morphology","Open","3x5","-statistic","median","3x5","-shear","3x2","-distort","SRT","1.1,13","-vignette","0x2","-shadow","75x0.5-2+3","-fx","(u+p{w-1-i,h-1-j})/2","-fill","#12345680","-annotate","+3+4","Hello gjpqy","-draw","rectangle 1,2 11,12 circle 15,17 20,21 point 3,4 line 1,2 23,27","-fill","#65432180","-fuzz","100%","-floodfill","+0+0","-remap","pattern:checkerboard"] : ["-size", "601x601", operand, "-flip", "-gamma", "1.4", "-colorspace", "gray"];
        if (tool === "convert-write") args.push("-write", "/middle.bmp", "-negate");
        const expectedFiles = new Map([["/input", bytes]]), expected = tool === "compare" ? await runCompareCli([operand, operand, "/out.bmp"], expectedFiles) : tool === "mogrify" ? await runMogrifyCli(["-format", "png", ...args.slice(3), operand], expectedFiles) : await runConvertCli([...args, "png:/out.bmp"], expectedFiles);
        const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../../../", import.meta.url)), sourcefile: "pdf-metadata-worker.ts", contents: `
 import {runCompareCli,runConvertCli,runMogrifyCli} from './packages/safe-bash-command-imagemagick/src/index.ts';
 import {FsError} from '@poe-code/safe-fs/contracts';
 export default {async fetch(request,env){const {size,stdout,operand,tool,args}=await request.json();let outputSize=0;const output={async write(bytes){await env.BACKING.fetch('https://backing/result?position='+outputSize,{method:'PUT',body:bytes});outputSize+=bytes.length;}};let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{atomicFilePublication:true,retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(path){return files.has(path)?stat(files.get(path)):parent;},async capabilitiesFor(){return this.capabilities;},
 async lstat(path){const file=files.get(path);if(!file)throw new FsError('ENOENT');return stat(file);},
 async publishFileConditional(path,source){const id=path==='/middle.bmp'?'middle':'result';let size=0;for await(const bytes of source){await env.BACKING.fetch('https://backing/'+id+'?position='+size,{method:'PUT',body:bytes});size+=bytes.length;}if(id==='result')outputSize=size;const file={id,size};files.set(path,file);return stat(file);},
 async removeFileConditional(path){files.delete(path);removed++;},
 async open(path){const file={id:String(++id),size:0};files.set(path,file);opened++;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return stat(file);},async write(bytes,position){if(bytes.length>16384)throw new Error('large scratch write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+position,{method:'PUT',body:bytes});file.size=Math.max(file.size,position+bytes.length);return bytes.length;},async read(bytes,position){reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await response.arrayBuffer()));return bytes.length;},async close(){closed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});}};},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded compare allocation '+length);return Reflect.construct(target,args);}});
 try{const input={filesystem:fs,cwd:'/',...(stdout?{stdout:output}:{})};const metadata=tool==='compare'?await runCompareCli([operand,operand,stdout?'bmp:-':'/out.bmp'],input):tool==='mogrify'?await runMogrifyCli(["-format","png",...args.slice(3),operand],input):await runConvertCli([...args,stdout?"png:-":"png:/out.bmp"],input);return Response.json({metadata,opened,closed,removed,files:files.size,reads,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;}
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
            const response = await runtime.dispatchFetch("https://image/", { method: "POST", body: JSON.stringify({ size: bytes.length, stdout, operand, tool, args }) });
            if (response.status !== 200)
                throw new Error(await response.text());
            const result = await response.json() as {
                metadata: unknown;
                opened: number;
                closed: number;
                removed: number;
                files: number;
                reads: number;
                maxAllocation: number;
                nodeGlobals: boolean;
            };
            expect(result.metadata).toEqual(expected);
            expect(result.opened).toBeGreaterThan(generated ? 0 : 1);
            expect(result.closed).toBe(result.opened);
            expect(result.removed).toBe(result.opened - (generated ? 0 : tool === "compare" ? 2 : 1));
            expect(result.files).toBe(tool === "convert-write" ? 3 : stdout ? 1 : 2);
            expect(result.reads).toBeGreaterThan(8);
            expect(result.maxAllocation).toBeLessThanOrEqual(65536);
            expect(result.nodeGlobals).toBe(false);
            expect(await (await backing.fetch("https://backing/")).json()).toEqual(tool === "convert-write" ? ["/input", "/middle", "/result"] : ["/input", "/result"]);
            if (tool === "convert-write") {
                const middle = new Uint8Array(await (await backing.fetch("https://backing/middle")).arrayBuffer());
                expect(middle.length).toBeGreaterThan(1048576);
                expect(decodeImage(middle)).toEqual(decodeImage(expectedFiles.get("/middle.bmp")!));
            }
            expect(decodeImage(new Uint8Array(await (await backing.fetch("https://backing/result")).arrayBuffer()))).toEqual(decodeImage(expectedFiles.get(tool === "mogrify" ? "input.png" : "/out.bmp")!));
        }
        finally {
            await runtime.dispose();
        }
    });
