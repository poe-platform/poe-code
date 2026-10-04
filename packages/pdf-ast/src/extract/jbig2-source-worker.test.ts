import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { decodeJbig2ToRgba } from "./images.js";

it("skips growing external JBIG2 extension segments in Workerd with fixed input allocation", async () => {
  const original = new Uint8Array(
      readFileSync(new URL("../fixtures/jbig2-generic-stream.bin", import.meta.url))
    ),
    expected = decodeJbig2ToRgba(original, 64, 32);
  const sum = expected.reduce((sum, value, index) => (sum + value * (index + 1)) % 1000000007, 0),
    inputs = new Map<number, Uint8Array>();
  for (const size of [131072, 524288]) {
    const input = new Uint8Array(size + 11 + original.length),
      view = new DataView(input.buffer);
    input[4] = 62; view.setUint32(7, size);
    input.set(original, size + 11);
    inputs.set(size, input);
  }
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      contents: `
 import {PdfRetainedJbig2} from './packages/pdf-ast/src/extract/retained-jbig2.ts';
 export default {async fetch(request,env){const {size,length}=await request.json();let peak=0,readBytes=0;const originals=new Map();
 for(const name of ['Int8Array','Uint8Array','Uint8ClampedArray','Uint16Array','Int32Array','Float32Array']){const Native=globalThis[name];originals.set(name,Native);globalThis[name]=new Proxy(Native,{construct(target,args){const bytes=typeof args[0]==='number'?args[0]*target.BYTES_PER_ELEMENT:args[0]?.byteLength??(args[0]?.length??0)*target.BYTES_PER_ELEMENT;peak=Math.max(peak,bytes);if(bytes>65536)throw Error('whole JBIG2 allocation '+bytes);return Reflect.construct(target,args);}});}
 try{const input={size:length,chunkBytes:128,async read(at,length){if(length>128)throw Error('large source request');readBytes+=length;return new Uint8Array(await(await env.INPUT.fetch('https://input/?size='+size+'&at='+at+'&length='+length)).arrayBuffer());},stream(){throw Error('whole source');}};
 const image=await PdfRetainedJbig2.open(input,64,32);let sum=0,index=0;try{for await(const row of image.rows())for(const value of row)sum=(sum+value*(++index))%1000000007;}finally{image.close();}
 return Response.json({sum,peak,readBytes,decoderBytes:image.decoderBytes,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{for(const [name,Native]of originals)globalThis[name]=Native;}}};`
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
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    cf: false,
    script: bundle.outputFiles[0]!.text,
    serviceBindings: {
      INPUT: async (request: Request) => {
        const url = new URL(request.url),
          at = Number(url.searchParams.get("at"));
        return new Response(
          inputs
            .get(Number(url.searchParams.get("size")))!
            .slice(at, at + Number(url.searchParams.get("length")))
        );
      }
    }
  });
  let allocation: number | undefined;
  try {
    for (const [size, input] of inputs) {
      const response = await runtime.dispatchFetch("https://verify/", {
        method: "POST",
        body: JSON.stringify({ size, length: input.length })
      });
      if (response.status !== 200) throw Error(await response.text());
      const result = (await response.json()) as {
        sum: number;
        peak: number;
        readBytes: number;
        decoderBytes: number;
        nodeGlobals: boolean;
      };
      expect(result.sum).toBe(sum);
      expect(result.peak).toBeLessThanOrEqual(65536);
      expect(result.readBytes).toBeLessThan(size);
      expect(result.nodeGlobals).toBe(false);
      if (allocation !== undefined) expect(result.decoderBytes).toBe(allocation);
      allocation = result.decoderBytes;
    }
  } finally {
    await runtime.dispose();
  }
}, 15000);
