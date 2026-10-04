import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

let script: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      sourcefile: "cff-path-worker.ts",
      contents: `
import {createCffGlyphRenderer} from './packages/pdf-ast/src/fonts/cff.ts';
import {StoredPathWriter,readStoredPath} from './packages/pdf-ast/src/content/stored-path.ts';
export default {async fetch(request,env){
 const {count,mode}=await request.json(),code=new Uint8Array((mode==='operands'?5:4)+count*2);
 code.set([139,139,21]);
 if(mode==='operands'){for(let i=0;i<count;i++)code.set([140,139],3+i*2);code[code.length-2]=5;}else for(let i=0;i<count;i++)code.set([32,10],3+i*2);
 code[code.length-1]=14;
 const cff={isCIDFont:false,charset:{charset:['A']},charStrings:{objects:[code]},globalSubrIndex:{objects:[]},topDict:{getByName:()=>[1,0,0,1,0,0],privateDict:{subrsIndex:{objects:[Uint8Array.of(140,139,5,11)]}}}};
 let admission=0,end=0,reads=0,writes=0;
 const render=createCffGlyphRenderer(cff,{onAllocation(bytes){admission+=bytes;if(admission>40000)throw Error('growing outline admission');}});
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const writer=new StoredPathWriter(storage);
 for await(const segment of render.storedSegments(0,storage))await writer.append(segment);
 const path=await writer.finish();let segments=0,last;
 for await(const segment of readStoredPath(path)){segments++;if(segment.kind==='line')last=segment;}
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
  script = bundle.outputFiles[0]!.text;
});

it.each(["subroutines", "operands"])("backs growing CFF %s in Workerd", async mode => {
  const bytes = new Uint8Array(512 * 1024);
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    cf: false,
    script,
    serviceBindings: {
      BACKING: async (request: Request) => {
        const url = new URL(request.url),
          at = Number(url.searchParams.get("at"));
        if (request.method === "PUT") {
          bytes.set(new Uint8Array(await request.arrayBuffer()), at);
          return new Response();
        }
        return new Response(bytes.slice(at, at + Number(url.searchParams.get("length"))));
      }
    }
  });
  let previousAdmission = 0;
  try {
    for (const count of [1024, 4096]) {
      const response = await runtime.dispatchFetch("https://worker/", {
        method: "POST",
        body: JSON.stringify({ count, mode })
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
      expect(result.segments).toBe(count + 2);
      expect(result.last).toEqual({ kind: "line", x: count, y: 0 });
      expect(result.admission).toBeLessThanOrEqual(40000);
      if (previousAdmission) expect(result.admission).toBe(previousAdmission);
      previousAdmission = result.admission;
      expect(result.reads).toBeGreaterThan(10);
      expect(result.writes).toBeGreaterThan(10);
      expect(result.node).toBe(false);
    }
  } finally {
    await runtime.dispose();
  }
});
