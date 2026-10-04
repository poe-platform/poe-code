import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it.each(["operands", "indexes"])(
  "backs growing CFF %s in an external Worker with fixed admission",
  async (mode) => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
        sourcefile: "stored-cff-worker.ts",
        contents: `
import {parseStoredCffFont} from './packages/pdf-ast/src/fonts/stored-cff.ts';
export default {async fetch(request,env){
 const {size}=await request.json();let end=size,admission=0,reads=0,writes=0;
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const font=await parseStoredCffFont({storage,position:0,byteLength:size},undefined,new Map(),{onAllocation(n){admission+=n;if(admission>300000)throw Error('growing CFF admission');}});
 let segments=0,last;for await(const segment of font.glyphSegments(0)){segments++;if(segment.kind==='line')last=segment;}
 return Response.json({admission,segments,last,reads,writes,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
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
      let previous = 0,
        previousReads = 0,
        previousWrites = 0;
      for (const count of [1000, 4000]) {
        data.fill(0);
        const size = mode === "operands" ? 32 + count * 2 + 5 : 24 + (count + 1) * 4;
        data.set([
          1, 0, 4, 4, 0, 0, 0, 1, 1, 1, 7, 29, 0, 0, 0, 21, 17, 0, 0, 0, 0, 0, 1, 4, 0, 0, 0, 1
        ]);
        if (mode === "operands") {
          new DataView(data.buffer).setUint32(28, count * 2 + 6);
          data.set([139, 139, 21], 32);
          for (let i = 0; i < count; i++) data.set([140, 139], 35 + i * 2);
          data[size - 2] = 5;
          data[size - 1] = 14;
        } else {
          const view = new DataView(data.buffer);
          view.setUint16(21, count);
          for (let i = 0; i <= count; i++) view.setUint32(24 + i * 4, 1);
        }
        const response = await runtime.dispatchFetch("https://worker/", {
          method: "POST",
          body: JSON.stringify({ size })
        });
        if (response.status !== 200) throw Error(await response.text());
        const result = (await response.json()) as {
          admission: number;
          segments: number;
          last: unknown;
          reads: number;
          writes: number;
          node: boolean;
        };
        expect(result.segments).toBe(mode === "operands" ? count + 2 : 0);
        if (mode === "operands")
          expect(result.last).toEqual({ kind: "line", x: count * 0.001, y: 0 });
        expect(result.admission).toBeLessThanOrEqual(300000);
        if (previous) expect(result.admission).toBe(previous);
        previous = result.admission;
        expect(result.reads).toBeGreaterThan(previousReads);
        expect(result.writes).toBeGreaterThan(previousWrites);
        previousReads = result.reads;
        previousWrites = result.writes;
        expect(result.node).toBe(false);
      }
    } finally {
      await runtime.dispose();
    }
  }
);
