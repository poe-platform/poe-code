import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { PdfDocument } from "../document.js";
import { cosBool, cosDict, cosName, cosNumber, cosArray, cosStream, dictSet } from "../ast.js";

let script: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
      sourcefile: "stored-captures-worker.ts",
      contents: `
 import {PdfRetainedDocument} from './packages/pdf-ast/src/retained-document.ts';
 import {PdfFileSource} from './packages/pdf-ast/src/source.ts';
 import {renderOperationStreamWindow} from './packages/pdf-ast/src/render/raster.ts';
 export default {async fetch(request,env){const {size}=await request.json();let id=0,opened=0,closed=0,removed=0,maxAllocation=0,reads=0;
 const scope={},files=new Map([['/input',{id:'input',size}]]);
 const stat=(file,type='file')=>({type,size:file.size,mode:420,mtimeMs:1,ctimeMs:1,atimeMs:1,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent=stat({id:'root',size:0},'directory');
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},async capabilitiesFor(){return this.capabilities;},
 async openReadFile(path){const file=files.get(path);if(!file)throw new Error('missing retained source');opened++;return {async stat(){return stat(file);},async read(position,length){if(length>65536)throw new Error('large request');reads++;const response=await env.BACKING.fetch('https://backing/'+file.id+'?position='+position+'&length='+length);return new Uint8Array(await response.arrayBuffer());},async close(){closed++;}};},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(chunk){if(chunk.length>65536)throw new Error('large write');await env.BACKING.fetch('https://backing/'+file.id+'?position='+file.size,{method:'PUT',body:chunk});file.size+=chunk.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);removed++;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 readFile(){throw new Error('whole input');},writeFile(){throw new Error('whole output');}};

 const Native=Uint8Array,push=Array.prototype.push;
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const length=typeof args[0]==='number'?args[0]:args[0]?.byteLength??args[0]?.length??0;maxAllocation=Math.max(maxAllocation,length);if(length>8192)throw Error('unbounded capture bytes '+length+' '+new Error().stack);return Reflect.construct(target,args);}});
 Array.prototype.push=function(...items){if(this.length+items.length>8&&items.some(item=>item&&typeof item==='object'&&'value' in item&&['path','glyph','image','group'].includes(item.kind)))throw Error('collected operations');return Reflect.apply(push,this,items);};
 let source,document;
 try{let end=0;const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large record read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/pixels?position='+at+'&length='+n)).arrayBuffer());},async write(at,b){if(b.length>4096)throw Error('large record write');await env.BACKING.fetch('https://backing/pixels?position='+at,{method:'PUT',body:b});}};
 const index={fs,directory:'/'};source=await PdfFileSource.open(fs,'/input',{chunkBytes:256,cacheBytes:256});document=await PdfRetainedDocument.open(source,index,{chunkBytes:256,xref:{index:{chunkBytes:4096,cacheBytes:4096}}});
 const page=(await document.pages().next()).value;
 const image=await renderOperationStreamWindow({width:4,height:4},async function*(){for await(const event of page.evaluateSteps(index,{imageStorage:storage,chunkBytes:256}))if(!event.captured)yield event.operation;},{x:1,y:1,width:1,height:1},{scale:1,transparent:true});
 await document.close();document=undefined;await source.close();source=undefined;
 await env.BACKING.fetch('https://backing/pixels',{method:'DELETE'});
 return Response.json({pixels:[...image.data],maxAllocation,reads,opened,closed,files:files.size,nodeGlobals:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await document?.close();await source?.close();globalThis.Uint8Array=Native;Array.prototype.push=push;}
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
it.each(["group", "mask"])("evaluates growing %s captures in a Worker with external backing", async mode => {
  const backing = new Map<string, { bytes: Uint8Array; size: number }>();
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    cf: false,
    script,
    serviceBindings: {
      BACKING: async (request: Request) => {
        const url = new URL(request.url),
          key = url.pathname,
          position = Number(url.searchParams.get("position"));
        if (request.method === "DELETE") {
          backing.delete(key);
          return new Response();
        }
        if (request.method === "PUT") {
          const chunk = new Uint8Array(await request.arrayBuffer());
          let file = backing.get(key);
          const end = position + chunk.length;
          if (!file || end > file.bytes.length) {
            const bytes = new Uint8Array(Math.max(end, (file?.bytes.length ?? 2048) * 2));
            if (file) bytes.set(file.bytes);
            file = { bytes, size: file?.size ?? 0 }; backing.set(key, file);
          }
          file.bytes.set(chunk, position); file.size = Math.max(file.size, end);
          return new Response();
        }
        return new Response(
          backing.get(key)!.bytes.slice(position, Math.min(backing.get(key)!.size, position + Number(url.searchParams.get("length"))))
        );
      }
    }
  });
  try {
    // Trip capture collection after eight records; a fourfold growth still
    // exercises external replay without thousands of redundant service calls.
    for (const count of [16, 64]) {
        const original = PdfDocument.create(),
          page = original.addPage(),
          nums = (v: number[]) => cosArray(v.map((n) => cosNumber(n)));
        dictSet(page.pageDict, "MediaBox", nums([0, 0, 4, 4]));
        const form = original.cos.allocateObject(
          cosStream(new TextEncoder().encode("0 0 4 4 re f ".repeat(count)), {
            dict: cosDict({
              Type: cosName("XObject"),
              Subtype: cosName("Form"),
              BBox: nums([0, 0, 4, 4]),
              Resources: cosDict(),
              Group: cosDict({ S: cosName("Transparency"), I: cosBool(true) })
            })
          })
        );
        dictSet(
          page.pageDict,
          "Resources",
          cosDict({
            XObject: cosDict({ F: form }),
            ExtGState: cosDict({ M: cosDict({ SMask: cosDict({ S: cosName("Alpha"), G: form }) }) })
          })
        );
        dictSet(
          page.pageDict,
          "Contents",
          original.cos.allocateObject(
            cosStream(new TextEncoder().encode(mode === "mask" ? "/M gs 0 0 4 4 re f" : "/F Do"))
          )
        );
        const bytes = original.save();
        backing.set("/input", { bytes, size: bytes.length });
        const response = await runtime.dispatchFetch("https://verify/", {
          method: "POST",
          body: JSON.stringify({ size: bytes.length })
        });
        if (response.status !== 200) throw Error(await response.text());
        const result = (await response.json()) as {
          pixels: number[];
          maxAllocation: number;
          reads: number;
          opened: number;
          closed: number;
          files: number;
          nodeGlobals: boolean;
        };
        expect(result.pixels).toEqual([0, 0, 0, 255]);
        expect(result.maxAllocation).toBeLessThanOrEqual(8192);
        expect(result.reads).toBeGreaterThan(8);
        expect(result.opened).toBe(result.closed);
        expect(result.files).toBe(1);
        expect(result.nodeGlobals).toBe(false);
        expect([...backing.keys()]).toEqual(["/input"]);
      }
  } finally {
    await runtime.dispose();
  }
}, 15000);
