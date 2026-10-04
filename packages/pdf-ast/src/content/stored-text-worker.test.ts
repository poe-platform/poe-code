import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("decodes and evaluates growing text with external backing and fixed Worker scratch", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      sourcefile: "stored-text-worker.ts",
      contents: `
import {CosRangeLexer} from './packages/pdf-ast/src/cos/lexer.ts';
import {evaluateContentSteps} from './packages/pdf-ast/src/content/evaluator.ts';
export default {async fetch(request,env){
 const {count}=await request.json();let end=0,admission=0,reads=0,writes=0;
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 const source={size:count+2,chunkBytes:256,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i;bytes[i]=p===0?40:p===count+1?41:65;}return bytes;}};
 const lexer=new CosRangeLexer(source,{stringStorage:storage,onTokenAllocation(n){admission+=n;if(admission>16384)throw Error('growing token scratch');}});
 const token=await lexer.nextToken();if(token.bytes.length)throw Error('resident token');
 const work=evaluateContentSteps({pageIndex:0,width:612,height:792});let sent=false,glyphs=0,step=work.next();
 while(!step.done){const r=step.value;let reply;
  if(r.kind==='node'){if(!sent){sent=true;reply={kind:'text-object',commands:[{kind:'font',fontName:'F',size:10},{kind:'show-text',token:{kind:'string',bytes:token.bytes,storedBytes:token.storedBytes}}],end:true};}}
  else if(r.kind==='font')reply=undefined;
  else if(r.kind==='catalog')reply={kind:'resolved',node:undefined};
  else if(r.kind==='string-bytes')reply={kind:'resolved',node:{kind:'string',bytes:await storage.read(r.value.position+r.offset,r.length)}};
  else if('operation' in r){if(r.operation.kind==='glyph')glyphs++;}
  else throw Error('unexpected '+r.kind);
  step=work.next(reply);
 }
 return Response.json({admission,glyphs,reads,writes,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
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
  const data = new Uint8Array(256 * 1024);
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
    let previousReads = 0,
      previousWrites = 0;
    for (const count of [8192, 65536]) {
      const response = await runtime.dispatchFetch("https://worker/", {
        method: "POST",
        body: JSON.stringify({ count })
      });
      if (response.status !== 200) throw Error(await response.text());
      const result = (await response.json()) as {
        admission: number;
        glyphs: number;
        reads: number;
        writes: number;
        node: boolean;
      };
      expect(result.admission).toBe(16384);
      expect(result.glyphs).toBe(count);
      expect(result.node).toBe(false);
      expect(result.reads).toBeGreaterThan(previousReads);
      expect(result.writes).toBeGreaterThan(previousWrites);
      previousReads = result.reads;
      previousWrites = result.writes;
    }
  } finally {
    await runtime.dispose();
  }
});
