import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import sharp from "@poe-code/image-ast";
it.each(["png", "heif"] as const)("mutates and inspects %s above the cache size using external Worker storage and bounded allocations", async (format) => {
    const input = await sharp({ create: { width: 531, height: 513, channels: 4, background: "red" } }).toFormat(format).toBuffer();
    const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../../../", import.meta.url)), sourcefile: "sips-worker.ts", contents: `
 import {runSipsCli,runIdentifyCli} from 'safe-bash-command-sips';
 import {FsError} from '@poe-code/safe-fs/contracts';
 export default {async fetch(request,env){
  const {size}=await request.json();let handles=0,closed=0,sourceClosed=0,writes=0,maxAllocation=0;
  const fs={capabilities:{retainedRead:true,atomicFilePublication:true},async stat(){return {type:'directory'};},async lstat(){throw new FsError('ENOENT');},async removeFileConditional(){},
   async openReadFile(){return {async stat(){return {type:'file',size,opaqueVersion:'input'};},async read(position,length){if(length>16384)throw new Error('large input read');const result=await env.IO.fetch('https://io/input?position='+position+'&length='+length);return new Uint8Array(await result.arrayBuffer());},async close(){sourceClosed++;}};},
   async publishFileConditional(path,source){for await(const bytes of source){if(bytes.length>16384)throw new Error('large output');await env.IO.fetch('https://io/output',{method:'POST',body:bytes});}},
   async open(){const id=++handles;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},
    async write(bytes,position){if(bytes.length>16384)throw new Error('large scratch write');writes++;await env.IO.fetch('https://io/scratch/'+id+'?position='+position,{method:'PUT',body:bytes});return bytes.length;},
    async read(bytes,position){if(bytes.length>16384)throw new Error('large scratch read');const result=await env.IO.fetch('https://io/scratch/'+id+'?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await result.arrayBuffer()));return bytes.length;},async close(){closed++;}};},
   readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};
  const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('large allocation');return Reflect.construct(target,args);}});
  try{const inspection=await runIdentifyCli(['-verbose','in'],{filesystem:fs,cwd:'/'});if(inspection.exitCode!==0)throw new Error(inspection.stderr);const result=await runSipsCli(['-r','90','-s','format','png','in','-o','out'],{filesystem:fs,cwd:'/'});return Response.json({result,handles,closed,sourceClosed,writes,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});}
  finally{globalThis.Uint8Array=Native;}
 }};` }, bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "esm", metafile: true, logLevel: "silent" });
    expect(Object.values(bundle.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
    const scratch = new Map<string, Uint8Array>(), output: Uint8Array[] = [];
    const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-01", cf: false, script: bundle.outputFiles[0]!.text, serviceBindings: { IO: async (request: Request) => {
                const url = new URL(request.url), position = Number(url.searchParams.get("position")), length = Number(url.searchParams.get("length")), key = url.pathname + ":" + position;
                if (url.pathname === "/input")
                    return new Response(input.slice(position, position + length));
                if (url.pathname === "/output") {
                    output.push(new Uint8Array(await request.arrayBuffer()));
                    return new Response();
                }
                if (request.method === "PUT") {
                    scratch.set(key, new Uint8Array(await request.arrayBuffer()));
                    return new Response();
                }
                return new Response(scratch.get(key)?.slice(0, length));
            } } });
    try {
        const response = await runtime.dispatchFetch("https://worker/", { method: "POST", body: JSON.stringify({ size: input.length }) });
        expect(response.status).toBe(200);
        const result = await response.json() as {
            result: {
                exitCode: number;
                stderr: string;
            };
            handles: number;
            closed: number;
            sourceClosed: number;
            writes: number;
            maxAllocation: number;
            nodeGlobals: boolean;
        };
        expect(result.result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.handles).toBeGreaterThan(0);
        expect(result.closed).toBe(result.handles);
        expect(result.sourceClosed).toBe(2);
        expect(result.writes).toBeGreaterThan(0);
        expect(result.maxAllocation).toBeLessThanOrEqual(65536);
        expect(result.nodeGlobals).toBe(false);
        const bytes = new Uint8Array(output.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0;
        for (const chunk of output) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        expect(await sharp(bytes).metadata()).toMatchObject({ width: 513, height: 531 });
        expect(await sharp(bytes).raw().toBuffer()).toEqual(await sharp(input).rotate(90).raw().toBuffer());
    }
    finally {
        await runtime.dispose();
    }
}, 15000);
