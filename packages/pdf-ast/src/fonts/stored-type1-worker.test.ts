import { parseEmbeddedType1Font } from "./type1.js";
import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it.each(["outlines", "glyphs"])(
  "parses and renders growing Type1 %s with external Worker backing and fixed admission",
  async (mode) => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
        sourcefile: "stored-type1-worker.ts",
        contents: `
import {parseStoredType1Font} from './packages/pdf-ast/src/fonts/stored-type1.ts';
export default {async fetch(request,env){
 const {size,length1}=await request.json();let end=size,admission=0,reads=0,writes=0;
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const font=await parseStoredType1Font({storage,position:0,byteLength:size},{length1,length2:size-length1,fontMatrix:[.001,0,0,.001,0,0],bbox:[0,0,0,0],flags:32,widths:{}},{onAllocation(n){admission+=n;if(admission>400000)throw Error('growing Type1 admission');}});
 let segments=0,last;for await(const segment of font.glyphSegments(65)){segments++;if(segment.kind==='line')last=segment;}
 return Response.json({admission,segments,last,unicode:await font.getUnicode(65),reads,writes,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
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
    const data = new Uint8Array(4 * 1024 * 1024);
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2026-07-01",
      cf: false,
      script: bundle.outputFiles[0]!.text,
      serviceBindings: {
        BACKING: async (request: Request) => {
          const url = new URL(request.url),
            at = Number(url.searchParams.get("at"));
          if (request.method === "PUT") {
            data.set(new Uint8Array(await request.arrayBuffer()), at);
            return new Response();
          }
          return new Response(data.slice(at, at + Number(url.searchParams.get("length"))));
        }
      }
    });
    try {
      let previousAdmission = 0,
        previousReads = 0,
        previousWrites = 0;
      for (const count of mode === "outlines" ? [300, 1200] : [16, 64]) {
        const header = "%!PS\n/FontMatrix [.001 0 0 .001 0 0] def currentfile eexec\n";
        const code =
          String.fromCharCode(139, 248, 136, 13, 139, 139, 21) +
          String.fromCharCode(140, 139, 5).repeat(mode === "outlines" ? count : 1) +
          String.fromCharCode(14);
        const plain =
          "\0\0\0\0/lenIV -1 def /Subrs 0 array def /CharStrings 100 dict dup begin /A " +
          code.length +
          " RD " +
          code +
          " ND " +
          (mode === "glyphs"
            ? Array.from(
                { length: count },
                (_, i) => `/unused${i} ${code.length} RD ${code} ND `
              ).join("")
            : "") +
          "end";
        let key = 55665;
        const encrypted = Array.from(plain, (c) => {
          const value = c.charCodeAt(0) ^ (key >> 8);
          key = ((value + key) * 52845 + 22719) & 65535;
          return value;
        });
        data.fill(0);
        data.set(Array.from(header, (c) => c.charCodeAt(0)));
        data.set(encrypted, header.length);
        const response = await runtime.dispatchFetch("https://worker/", {
          method: "POST",
          body: JSON.stringify({ size: header.length + encrypted.length, length1: header.length })
        });
        if (response.status !== 200) throw Error(await response.text());
        const result = (await response.json()) as {
          admission: number;
          segments: number;
          last: unknown;
          unicode: string;
          reads: number;
          writes: number;
          node: boolean;
        };
        const native = parseEmbeddedType1Font(data.slice(0, header.length + encrypted.length), {
          length1: header.length,
          length2: encrypted.length,
          fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
          bbox: [0, 0, 0, 0],
          flags: 32,
          widths: {}
        });
        expect(result.segments).toBe(native.getGlyphOutline(65)!.length);
        expect(result.last).toEqual(
          native
            .getGlyphOutline(65)!
            .filter((segment) => segment.kind === "line")
            .at(-1)
        );
        expect(result.unicode).toBe("A");
        expect(result.node).toBe(false);
        if (previousAdmission) expect(result.admission).toBe(previousAdmission);
        expect(result.reads).toBeGreaterThan(previousReads);
        expect(result.writes).toBeGreaterThan(previousWrites);
        previousAdmission = result.admission;
        previousReads = result.reads;
        previousWrites = result.writes;
      }
    } finally {
      await runtime.dispose();
    }
  }
);
