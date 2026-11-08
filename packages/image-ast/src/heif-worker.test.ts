import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { decodeHeifImage } from "./codecs/heif.js";
it("streams HEIF in Workerd through injected external scratch without large allocations", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
      sourcefile: "stream-output-worker.ts",
      contents: `
 import sharp from '@poe-code/image-ast';
 export default {async fetch(request,env){
 const {observeInfo}=await request.json();let handles=0,closed=0,writes=0,maxAllocation=0;
 const fs={capabilities:{},async stat(){return {type:'directory'};},async removeFileConditional(){},async open(){const id=++handles;return {
 capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},
 async write(bytes,position){if(bytes.length>16384)throw new Error('large write');writes++;await env.SCRATCH.fetch('https://scratch/'+id+'?position='+position,{method:'PUT',body:bytes});return bytes.length;},
 async read(bytes,position){if(bytes.length>16384)throw new Error('large read');const result=await env.SCRATCH.fetch('https://scratch/'+id+'?position='+position+'&length='+bytes.length);bytes.set(new Uint8Array(await result.arrayBuffer()));return bytes.length;},
 async close(){closed++;}};},readFile(){throw new Error('whole read');},writeFile(){throw new Error('whole write');}};
 const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=args[0],length=typeof value==='number'?value:value?.byteLength??value?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>65536)throw new Error('large allocation');return Reflect.construct(target,args);}});
 const input=sharp({create:{width:531,height:513,channels:4,background:'red'},filesystem:fs,workingDirectory:'/'}).heif();let info,total=0,chunks=0;const encoded=[];
 if(observeInfo)input.on('info',value=>{info=value;});
 try{for await(const bytes of input){if(bytes.length>16384)throw new Error('large output');if(observeInfo&&!(info?.size>0))throw new Error('late info');if(total+bytes.length>65536)throw new Error('fixture unexpectedly large');encoded.push(...bytes);total+=bytes.length;chunks++;}}
 finally{await input.dispose();globalThis.Uint8Array=Native;}
 return Response.json({encoded,total,chunks,handles,closed,writes,maxAllocation,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }};`
    },
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "esm",
    metafile: true,
    logLevel: "silent"
  });
  expect(Object.values(bundle.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  const scratch = new Map<string, Uint8Array>();
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    cf: false,
    script: bundle.outputFiles[0]!.text,
    serviceBindings: {
      SCRATCH: async (request) => {
        const url = new URL(request.url),
          position = Number(url.searchParams.get("position")),
          key = url.pathname + ":" + position;
        if (request.method === "PUT") {
          scratch.set(key, new Uint8Array(await request.arrayBuffer()));
          return new Response();
        }
        return new Response(scratch.get(key)?.slice(0, Number(url.searchParams.get("length"))));
      }
    }
  });
  try {
    for (const observeInfo of [false, true]) {
      const response = await runtime.dispatchFetch("https://output/", {
        method: "POST",
        body: JSON.stringify({ observeInfo })
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        encoded: number[];
        total: number;
        chunks: number;
        handles: number;
        closed: number;
        writes: number;
        maxAllocation: number;
        nodeGlobals: boolean;
      };
      const decoded = decodeHeifImage(Uint8Array.from(result.encoded));
      expect(decoded.width).toBe(531);
      expect(decoded.height).toBe(513);
      expect(decoded.data.every((v, i) => v === (i % 4 === 0 || i % 4 === 3 ? 255 : 0))).toBe(true);
      expect(result.chunks).toBeGreaterThan(0);
      expect(result.handles).toBe(1);
      expect(result.closed).toBe(result.handles);
      expect(result.writes).toBeGreaterThan(64);
      expect(result.maxAllocation).toBeLessThanOrEqual(65536);
      expect(result.nodeGlobals).toBe(false);
    }
  } finally {
    await runtime.dispose();
  }
}, 15000);
