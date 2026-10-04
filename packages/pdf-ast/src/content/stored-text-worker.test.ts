import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it.each(["token", "source", "array", "actual"])(
  "evaluates growing %s text with external backing and bounded Worker reads",
  async (mode) => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)),
        sourcefile: "stored-text-worker.ts",
        contents: `
import {parseCosRangeValue} from './packages/pdf-ast/src/cos/range-parser.ts';
import {dictGet} from './packages/pdf-ast/src/ast.ts';
import {CosRangeLexer} from './packages/pdf-ast/src/cos/lexer.ts';
import {parseContentRangeEvents} from './packages/pdf-ast/src/content/range-events.ts';
import {readStoredRecord} from './packages/pdf-ast/src/content/stored-record.ts';
import {evaluateContentSteps} from './packages/pdf-ast/src/content/evaluator.ts';
import {streamRawTextChunks} from './packages/pdf-ast/src/extract/raw-text-stream.ts';
export default {async fetch(request,env){
 const {count,mode}=await request.json();let end=0,admission=0,reads=0,writes=0;
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){if(n>4096)throw Error('large read');reads++;return new Uint8Array(await(await env.BACKING.fetch('https://backing/?at='+at+'&length='+n)).arrayBuffer());},async write(at,bytes){if(bytes.length>4096)throw Error('large write');writes++;await env.BACKING.fetch('https://backing/?at='+at,{method:'PUT',body:bytes});}};
 let token,nodes,peakItems=0;
 if(mode==='source'){
 const prefix='<< /Title (ordinary) /ActualText (',suffix=') >>';
 const source={size:prefix.length+count+suffix.length,chunkBytes:256,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i-prefix.length;bytes[i]=p<0?prefix.charCodeAt(at+i):p<count?65:suffix.charCodeAt(p-count);}return bytes;}};
 const {value}=await parseCosRangeValue(source,0,{stringStorage:storage,storedStringKeys:['ActualText']});
 token=dictGet(value,'ActualText');if(token.bytes.length||token.storedBytes.byteLength!==count)throw Error('resident source string');
 if(dictGet(value,'Title').bytes.length!==8)throw Error('changed ordinary string');
 }else if(mode==='token'){
 const source={size:count+2,chunkBytes:256,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i;bytes[i]=p===0?40:p===count+1?41:65;}return bytes;}};
 const lexer=new CosRangeLexer(source,{stringStorage:storage,onTokenAllocation(n){admission+=n;if(admission>16384)throw Error('growing token scratch');}});
 token=await lexer.nextToken();if(token.bytes.length)throw Error('resident token');
 }else{
 const prefix=mode==='actual'?'/Span << /ActualText (':'BT /F 10 Tf [',pattern=mode==='actual'?'A':'(A) -1 ',suffix=mode==='actual'?') >> BDC BT /F 10 Tf (A) Tj ET EMC':'] TJ ET';
 const source={size:prefix.length+pattern.length*count+suffix.length,chunkBytes:256,async read(at,n){const bytes=new Uint8Array(n);for(let i=0;i<n;i++){const p=at+i-prefix.length;bytes[i]=p<0?prefix.charCodeAt(at+i):p<pattern.length*count?pattern.charCodeAt(p%pattern.length):suffix.charCodeAt(p-pattern.length*count);}return bytes;}};
 nodes=parseContentRangeEvents(source,{fs:{},directory:'/'},{pathStorage:storage,retainActualText:mode==='actual'});
 }
 const work=evaluateContentSteps({pageIndex:0,width:612,height:792});let sent=false,glyphs=0,outputGlyph,step=work.next();
 while(!step.done){const r=step.value;let reply;
  if(r.kind==='node'){if(nodes){reply=(await nodes.next()).value;if(reply?.kind==='text-object')for(const command of reply.commands)if(command.kind==='show-text-array'){peakItems=Math.max(peakItems,command.items.length);if(command.storedItems?.length!==count*2)throw Error('missing backed elements');}}else if(!sent){sent=true;reply={kind:'text-object',commands:[{kind:'font',fontName:'F',size:10},{kind:'show-text',token:{kind:'string',bytes:token.bytes,storedBytes:token.storedBytes}}],end:true};}}
  else if(r.kind==='array-item'){const record=await readStoredRecord(r.items.storage,r.position);reply={kind:'resolved',node:{kind:'array',items:[{kind:'number',value:record.next},record.value]}};}
  else if(r.kind==='font')reply=undefined;
  else if(r.kind==='catalog')reply={kind:'resolved',node:undefined};
  else if(r.kind==='string-bytes')reply={kind:'resolved',node:{kind:'string',bytes:await storage.read(r.value.position+r.offset,r.length)}};
  else if('operation' in r){if(r.operation.kind==='glyph'){glyphs++;outputGlyph=r.operation.value;if(mode==='actual'&&(r.operation.value.actualText!==undefined||r.operation.value.storedActualText?.byteLength!==count))throw Error('expanded ActualText');}}
  else throw Error('unexpected '+r.kind);
  step=work.next(reply);
 }
 let outputLength=0,live=false;
 if(mode==='actual'){
  let start=0,size=0,revision=0;const scope={},stat=()=>({type:'file',size,revision,identityScope:scope,opaqueIdentity:'line'});
  const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return {type:'directory',size:0};},
   async createStagedFile(path){if(live)throw Error('overlapping lines');live=true;start=storage.allocate(count);return {file:{path,stat:stat()},writer:{async write(bytes){await storage.write(start+size,bytes);size+=bytes.length;revision++;},async finish(){return stat();}},cleanup:{async remove(){live=false;},async close(){}}};},
   async openReadFile(){return {async stat(){return stat();},async read(at,n){return storage.read(start+at,n);},async close(){}};},
   readFile(){throw Error('whole read');},writeFile(){throw Error('whole write');}};
  for await(const bytes of streamRawTextChunks([outputGlyph],{fs,directory:'/'},{chunkBytes:256})){if(!bytes.every(byte=>byte===65))throw Error('wrong replacement bytes');outputLength+=bytes.length;}
 }
 return Response.json({admission,peakItems,glyphs,reads,writes,outputLength,live,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
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
    const data = new Uint8Array(1024 * 1024);
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
      for (const count of mode === "array" ? [128, 512] : [8192, 65536]) {
        const response = await runtime.dispatchFetch("https://worker/", {
          method: "POST",
          body: JSON.stringify({ count, mode })
        });
        if (response.status !== 200) throw Error(await response.text());
        const result = (await response.json()) as {
          admission: number;
          peakItems: number;
          glyphs: number;
          reads: number;
          writes: number;
          node: boolean;
          outputLength: number;
          live: boolean;
        };
        if (mode === "token") expect(result.admission).toBe(16384);
        else expect(result.peakItems).toBe(0);
        expect(result.glyphs).toBe(mode === "actual" ? 1 : count);
        expect(result.node).toBe(false);
        if (mode === "actual") { expect(result.outputLength).toBe(count); expect(result.live).toBe(false); }
        if (mode !== "actual") expect(result.reads).toBeGreaterThan(previousReads);
        expect(result.writes).toBeGreaterThan(previousWrites);
        previousReads = result.reads;
        previousWrites = result.writes;
      }
    } finally {
      await runtime.dispose();
    }
  }
);
