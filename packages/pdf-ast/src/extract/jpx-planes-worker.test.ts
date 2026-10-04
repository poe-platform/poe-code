import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeJpxToRgba } from "./images.js";

it.each(["wavelet", "bit-model", "codeblock-input", "segments"])(
  "decodes growing JPEG 2000 %s state in Workerd using external storage",
  async (profile) => {
    const images = new Map<number, { bytes: Uint8Array; sum: number }>();
    const original = new Uint8Array(
      readFileSync(new URL("../fixtures/rgb-lossless.j2k", import.meta.url))
    );
    let siz = -1,
      sot = -1,
      sod = -1,
      cod = -1;
    for (let i = 0; i < original.length - 1; i++)
      if (original[i] === 255) {
        if (original[i + 1] === 81) siz = i + 2;
        if (original[i + 1] === 82) cod = i + 2;
        if (original[i + 1] === 144) sot = i + 2;
        if (original[i + 1] === 147) {
          sod = i + 2;
          break;
        }
      }
    for (const height of [129, 513]) {
      const length = height === 129 ? 131072 : 524288;
      const binary = length.toString(2);
      const bits = "1110" + "1".repeat(binary.length - 3) + "0" + binary;
      const header: number[] = [];
      let value = 0, left = 8;
      for (const bit of bits) {
        value = (value << 1) | Number(bit);
        if (--left === 0) { header.push(value); left = value === 255 ? 7 : 8; value = 0; }
      }
      if (left !== 8) header.push(value << left);
      const part = header.length + length;
      const layers = height === 129 ? 1025 : 4097;
      const bytes = new Uint8Array(sod + (profile === "segments" ? layers * 6 + 2 : profile === "codeblock-input" ? part * 3 + 2 : profile === "wavelet" ? 2 : 5));
      bytes.set(original.subarray(0, sod));
      bytes.set(profile === "wavelet" ? [255, 217] : [224, 224, 224, 255, 217], sod);
      const view = new DataView(bytes.buffer);
      for (const offset of [4, 20]) view.setUint32(siz + offset, profile === "wavelet" ? 33 : 65);
      for (const offset of [8, 24]) view.setUint32(siz + offset, height);
      view.setUint32(sot + 4, profile === "wavelet" ? 14 : 17);
      if (profile === "bit-model") {
        bytes[cod + 7] = 0;
        bytes[cod + 8] = 8;
        bytes[cod + 9] = 8;
      }
      if (profile === "codeblock-input") {
        for (let i = 0; i < 3; i++) bytes.set(header, sod + part * i);
        bytes.set([255, 217], sod + part * 3);
        for (const offset of [4, 8, 20, 24]) view.setUint32(siz + offset, 8);
        view.setUint32(sot + 4, 14 + part * 3);
        bytes[cod + 7] = 0; bytes[cod + 8] = 8; bytes[cod + 9] = 8;
      }
      if (profile === "segments") {
        bytes.fill(0, sod);
        for (let i = 0; i < layers * 3; i++) bytes[sod + i * 2] = i < 3 ? 225 : 194;
        bytes.set([255, 217], sod + layers * 6);
        for (const offset of [4, 8, 20, 24]) view.setUint32(siz + offset, 1);
        view.setUint32(sot + 4, 14 + layers * 6);
        view.setUint16(cod + 4, layers);
        bytes[cod + 7] = 0; bytes[cod + 8] = 0; bytes[cod + 9] = 0;
      }
      const expected = decodeJpxToRgba(bytes);
      images.set(height, {
        bytes,
        sum: expected.reduce(
          (sum, value, index) => (sum + value * ((index % 65521) + 1)) % 1000000007,
          0
        )
      });
    }

    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
        contents: `
 import {PdfRetainedJpx} from './packages/pdf-ast/src/extract/retained-jpx.ts';
 import {PagedStorage} from '@poe-code/safe-fs/storage';
 export default {async fetch(request,env){const {height,length}=await request.json();let writes=0,reads=0,opened=0,closed=0,peak=0,inputBytes=0;
 const fs={async stat(){return {type:'directory',size:0};},async removeFileConditional(){},async open(){opened++;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},async write(bytes,position){if(bytes.length>16384)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/coeff?at='+position,{method:'PUT',body:bytes});return bytes.length;},async read(bytes,position){if(bytes.length>16384)throw Error('large read');reads++;bytes.set(new Uint8Array(await(await env.BACKING.fetch('https://backing/coeff?at='+position+'&length='+bytes.length)).arrayBuffer()));return bytes.length;},async close(){closed++;await env.BACKING.fetch('https://backing/coeff',{method:'DELETE'});}};}};
 const storage=new PagedStorage({fs,cwd:'/',env:{},signal:new AbortController().signal},2),originals=new Map();
 for(const name of ['Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array']){const Native=globalThis[name];originals.set(name,Native);globalThis[name]=new Proxy(Native,{construct(target,args){const bytes=typeof args[0]==='number'?args[0]*target.BYTES_PER_ELEMENT:args[0]?.byteLength??(args[0]?.length??0)*target.BYTES_PER_ELEMENT;peak=Math.max(peak,bytes);if(bytes>65536)throw Error('whole JPX plane '+bytes);return Reflect.construct(target,args);}});}
 try{const source={size:length,chunkBytes:4096,async read(at,length){inputBytes+=length;if(length>4096)throw Error('whole input');return new Uint8Array(await(await env.BACKING.fetch('https://backing/input?height='+height+'&at='+at+'&length='+length)).arrayBuffer());}};
 const image=await PdfRetainedJpx.open(source,{coefficientStorage:storage,maxWorkingBytes:1048576});let sum=0,index=0;try{for await(const row of image.rows())for(const value of row)sum=(sum+value*(index++%65521+1))%1000000007;}finally{image.close();await storage.close();}
 return Response.json({sum,writes,reads,opened,closed,peak,inputBytes,decoderBytes:image.decoderBytes,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await storage.close();for(const [name,Native] of originals)globalThis[name]=Native;}}};`
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
    let backing = new Uint8Array();
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2026-07-01",
      cf: false,
      script: bundle.outputFiles[0]!.text,
      serviceBindings: {
        BACKING: async (request: Request) => {
          const url = new URL(request.url),
            at = Number(url.searchParams.get("at")),
            length = Number(url.searchParams.get("length"));
          if (url.pathname === "/input")
            return new Response(
              images.get(Number(url.searchParams.get("height")))!.bytes.slice(at, at + length)
            );
          if (request.method === "DELETE") {
            backing = new Uint8Array();
            return new Response();
          }
          if (request.method === "PUT") {
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (at + bytes.length > backing.length) {
              const next = new Uint8Array(Math.max(at + bytes.length, backing.length * 2));
              next.set(backing);
              backing = next;
            }
            backing.set(bytes, at);
            return new Response();
          }
          return new Response(backing.slice(at, at + length));
        }
      }
    });
    let previousDecoderBytes: number | undefined;
    try {
      for (const [height, input] of images) {
        const response = await runtime.dispatchFetch("https://verify/", {
          method: "POST",
          body: JSON.stringify({ height, length: input.bytes.length })
        });
        if (response.status !== 200) throw Error(await response.text());
        const result = (await response.json()) as {
          sum: number;
          writes: number;
          reads: number;
          opened: number;
          closed: number;
          peak: number;
          inputBytes: number;
          decoderBytes: number;
          nodeGlobals: boolean;
        };
        expect(result.sum).toBe(input.sum);
        if (profile === "segments") {
          if (previousDecoderBytes !== undefined) expect(result.decoderBytes).toBe(previousDecoderBytes);
          previousDecoderBytes = result.decoderBytes;
        }
        if (profile === "codeblock-input") {
          expect(result.inputBytes).toBeLessThan(65536);
          if (previousDecoderBytes !== undefined) expect(result.decoderBytes).toBe(previousDecoderBytes);
          previousDecoderBytes = result.decoderBytes;
        }
        if (profile !== "codeblock-input") expect(result.writes).toBeGreaterThan(2);
        if (profile !== "codeblock-input") expect(result.reads).toBeGreaterThan(0);
        expect(result.closed).toBe(result.opened);
        if (profile !== "codeblock-input") expect(result.opened).toBe(1);
        expect(result.peak).toBeLessThanOrEqual(65536);
        expect(result.decoderBytes).toBeLessThanOrEqual(1048576);
        expect(result.nodeGlobals).toBe(false);
        expect(backing.length).toBe(0);
      }
    } finally {
      await runtime.dispose();
    }
  },
  15000
);
