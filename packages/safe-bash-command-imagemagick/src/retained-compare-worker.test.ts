import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { runCompareCli, runConvertCli } from "./index.js";
for (const tool of ["compare", "convert"] as const)
for (const format of (tool === "compare" ? ["bmp", "svg", "label"] : ["bmp", "gradient", "radial-gradient", "pattern", "tile"]) as ("bmp" | "svg" | "label" | "gradient" | "radial-gradient" | "pattern" | "tile")[])
for (const stdout of [false, true])
    it(`runs ${tool} in Workerd, input=${format}, stdout=${stdout}`, async () => {
        const pixels = new Uint8Array(601 * 601 * 4);
        let state = 1234567;
        for (let i = 0; i < pixels.length; i++) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            pixels[i] = state & 255;
        }
        const bytes = format === "svg" ? new TextEncoder().encode('<svg width="601" height="601">' + " ".repeat(1048576) + '<rect width="601" height="601" fill="red"/><circle cx="300" cy="300" r="70" fill="blue"/></svg>') : await sharp(pixels, { raw: { width: 601, height: 601, channels: 4 } }).toFormat("bmp").toBuffer();
        expect(bytes.length).toBeGreaterThan(1048576);
        const generated = ["label", "gradient", "radial-gradient", "pattern", "tile"].includes(format);
        const operand = format === "label" ? "label:" + "x<&😀".repeat(600) : format === "gradient" || format === "radial-gradient" ? format + ":red-blue" : format === "pattern" ? "pattern:checkerboard" : format === "tile" ? "tile:rose:" : "/input";
        const args = format === "bmp" ? ["-size","601x601",operand,"-flip","-gamma","1.4","-colorspace","gray","-modulate","110,90,70","-function","Polynomial","0.5,0.2","-transparent","red","-level","20%,80%,1.3","-negate","-black-threshold","30%","-normalize","-auto-gamma","-crop","590x590+5+5","-background","#ff00ff80","-gravity","center","-extent","601x601"] : ["-size", "601x601", operand, "-flip", "-gamma", "1.4", "-colorspace", "gray"];
        const expectedFiles = new Map([["/input", bytes]]), expected = tool === "compare" ? await runCompareCli([operand, operand, "/out.bmp"], expectedFiles) : await runConvertCli([...args, "png:/out.bmp"], expectedFiles);
        const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../../../", import.meta.url)), sourcefile: "pdf-metadata-worker.ts", contents: `
 import {runCompareCli,runConvertCli} from './packages/safe-bash-command-imagemagick/src/index.ts';
 import {FsError} from '@poe-code/safe-fs/contracts';
 export default {async fetch(request,env){const {size,stdout,operand,tool,args}=await request.json();let outputSize=0;const output={async write(bytes){await env.BACKING.fetch('https://backing/result?position='+outputSize,{method:'PUT',body:bytes});outputSize+=bytes.length;}};let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{atomicFilePublication:true,retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async lstat(path){const file=files.get(path);if(!file)throw new FsError('ENOENT');return stat(file);},
 async publishFileConditional(path,source){for await(const bytes of source)await output.write(bytes);const file={id:'result',size:outputSize};files.set(path,file);return stat(file);},
 async removeFileConditional(path){files.delete(path);removed++;},
 async open(path){const file={id:String(++id),size:0};files.set(path,file);opened++;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return stat(file);},async write(bytes,position){if(bytes.length>16384)throw new Error('large scratch write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+position,{method:'PUT',body:bytes});file.size=Math.max(file.size,position+bytes.length);return bytes.length;},async read(bytes,position){reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await response.arrayBuffer()));return bytes.length;},async close(){closed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});}};},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('unbounded compare allocation '+length);return Reflect.construct(target,args);}});
 try{const input={filesystem:fs,cwd:'/',...(stdout?{stdout:output}:{})};const metadata=tool==='compare'?await runCompareCli([operand,operand,stdout?'bmp:-':'/out.bmp'],input):await runConvertCli([...args,stdout?"png:-":"png:/out.bmp"],input);return Response.json({metadata,opened,closed,removed,files:files.size,reads,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}finally{globalThis.Uint8Array=Native;}
 }};` }, bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "esm", metafile: true, logLevel: "silent" });
        expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
        const backing = new Map<string, Uint8Array>([["/input", bytes]]);
        const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: bundle.outputFiles[0]!.text, serviceBindings: { BACKING: async (request: Request) => {
                    const url = new URL(request.url), key = url.pathname, position = Number(url.searchParams.get("position"));
                    if (request.method === "DELETE") {
                        backing.delete(key);
                        return new Response();
                    }
                    if (request.method === "PUT") {
                        const chunk = new Uint8Array(await request.arrayBuffer()), old = backing.get(key) ?? new Uint8Array(), next = new Uint8Array(Math.max(old.length, position + chunk.length));
                        next.set(old);
                        next.set(chunk, position);
                        backing.set(key, next);
                        return new Response();
                    }
                    return new Response(backing.get(key)!.slice(position, position + Number(url.searchParams.get("length"))));
                } } });
        try {
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
            expect(result.files).toBe(stdout ? 1 : 2);
            expect(result.reads).toBeGreaterThan(8);
            expect(result.maxAllocation).toBeLessThanOrEqual(65536);
            expect(result.nodeGlobals).toBe(false);
            expect([...backing.keys()].sort()).toEqual(["/input", "/result"]);
            expect(decodeImage(backing.get("/result")!)).toEqual(decodeImage(expectedFiles.get("/out.bmp")!));
        }
        finally {
            await runtime.dispose();
        }
    });
