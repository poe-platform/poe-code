import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("renders growing TrueType programs and glyphs in Workerd through external caller storage", async () => {
  const inputs = new Map<number, Uint8Array>();
  for (const points of [4096, 16384]) {
    const bytes = new Uint8Array(points * 64),
      view = new DataView(bytes.buffer);
    view.setUint32(0, 0x10000);
    view.setUint16(4, 6);
    for (const [i, [tag, offset, length]] of (
      [
        ["head", 128, 54],
        ["hhea", 192, 36],
        ["maxp", 232, 6],
        ["hmtx", 240, 8],
        ["loca", 248, 6],
        ["glyf", 256, points + 12]
      ] as const
    ).entries()) {
      for (let j = 0; j < 4; j++) bytes[12 + i * 16 + j] = tag.charCodeAt(j);
      view.setUint32(20 + i * 16, offset);
      view.setUint32(24 + i * 16, length);
    }
    view.setUint16(146, 1000);
    view.setUint16(226, 2);
    view.setUint16(236, 2);
    view.setUint16(240, 500);
    view.setUint16(244, 700);
    view.setUint16(252, (points + 12) / 2);
    view.setInt16(256, 1);
    view.setUint16(266, points - 1);
    bytes.fill(0x31, 270, 270 + points);
    inputs.set(points, bytes);
  }
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      contents: `
 import {parseStoredTrueTypeFont} from './packages/pdf-ast/src/fonts/stored-truetype.ts';
 import {PagedStorage} from '@poe-code/safe-fs/storage';
 export default {async fetch(request,env){const {points,length}=await request.json();let writes=0,reads=0,opened=0,closed=0,peak=0,admitted=0;
 const fs={async stat(){return {type:'directory',size:0};},async removeFileConditional(){},async open(){opened++;return {capabilities:{positionedRead:true,positionedWrite:true},async stat(){return {type:'file',size:0};},async write(bytes,position){if(bytes.length>16384)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/scratch?at='+position,{method:'PUT',body:bytes});return bytes.length;},async read(bytes,position){if(bytes.length>16384)throw Error('large read');reads++;bytes.set(new Uint8Array(await(await env.BACKING.fetch('https://backing/scratch?at='+position+'&length='+bytes.length)).arrayBuffer()));return bytes.length;},async close(){closed++;await env.BACKING.fetch('https://backing/scratch',{method:'DELETE'});}};}};
 const scratch=new PagedStorage({fs,cwd:'/',env:{},signal:new AbortController().signal},2),originals=new Map();
 const storage={allocate(size){return length+scratch.allocate(size);},async write(at,bytes){return scratch.write(at-length,bytes);},async read(at,size){if(at>=length)return scratch.read(at-length,size);if(size>4096)throw Error('whole font read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/input?points='+points+'&at='+at+'&length='+size)).arrayBuffer());}};
 for(const name of ['Uint8Array','Int16Array','Int32Array','Uint32Array']){const Native=globalThis[name];originals.set(name,Native);globalThis[name]=new Proxy(Native,{construct(target,args){const bytes=typeof args[0]==='number'?args[0]*target.BYTES_PER_ELEMENT:args[0]?.byteLength??(args[0]?.length??0)*target.BYTES_PER_ELEMENT;peak=Math.max(peak,bytes);if(bytes>65536)throw Error('whole font allocation '+bytes);return Reflect.construct(target,args);}});}
 try{const font=await parseStoredTrueTypeFont({storage,position:0,byteLength:length},{maxWorkingBytes:32768,onAllocation(bytes){admitted+=bytes;}});let count=0;
 for await(const segment of font.glyphSegments(1)){if(segment.kind!=='close'&&(segment.x!==0||segment.y!==0))throw Error('wrong point');count++;}
 await scratch.close();return Response.json({count,writes,reads,opened,closed,peak,admitted,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await scratch.close();for(const [name,Native] of originals)globalThis[name]=Native;}}};`
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
            inputs.get(Number(url.searchParams.get("points")))!.slice(at, at + length)
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
  try {
    for (const [points, input] of inputs) {
      const response = await runtime.dispatchFetch("https://verify/", {
        method: "POST",
        body: JSON.stringify({ points, length: input.length })
      });
      if (response.status !== 200) throw Error(await response.text());
      const result = (await response.json()) as {
        count: number;
        writes: number;
        reads: number;
        opened: number;
        closed: number;
        peak: number;
        admitted: number;
        nodeGlobals: boolean;
      };
      expect(result.count).toBe(points + 1);
      expect(result.writes).toBeGreaterThan(0);
      expect(result.closed).toBe(result.opened);
      expect(result.opened).toBe(1);
      expect(result.peak).toBeLessThanOrEqual(65536);
      expect(result.admitted).toBe(32768);
      expect(result.nodeGlobals).toBe(false);
      expect(backing.length).toBe(0);
    }
  } finally {
    await runtime.dispose();
  }
}, 15000);
