import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("backs growing font width records in an external Worker with fixed admission", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      sourcefile: "stored-cff-worker.ts",
      contents: `
import {StoredFontWidths} from './packages/pdf-ast/src/fonts/stored-widths.ts';
export default {async fetch(request,env){
 const {count}=await request.json();let end=0,admission=0,reads=0,writes=0;
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const widths=new StoredFontWidths(storage,{onAllocation(n){admission+=n;if(admission>65536)throw Error('growing width admission');}});
 for(let i=0;i<count;i++)await widths.set(i*3,i+100,i*3+1);
 const result=[await widths.get(0),await widths.get(1),await widths.get(2),await widths.get((count-1)*3)];
 await widths.set(0,700,count*3);result.push(await widths.get(2));
 return Response.json({admission,result,reads,writes,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
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
    for (const count of [256, 1024]) {
      data.fill(0);
      const response = await runtime.dispatchFetch("https://worker/", {
        method: "POST",
        body: JSON.stringify({ count })
      });
      if (response.status !== 200) throw Error(await response.text());
      const result = (await response.json()) as {
        admission: number;
        result: (number | null)[];
        reads: number;
        writes: number;
        node: boolean;
      };
      expect(result.result).toEqual([100, 100, null, count + 99, 700]);
      expect(result.admission).toBe(65536);
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
});
