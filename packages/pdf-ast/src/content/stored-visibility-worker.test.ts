import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

it("evaluates growing layer lists in Workerd with external membership indexes", async () => {
  const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL("../../../../",import.meta.url)),sourcefile:"visibility-worker.ts",contents:`
import {cosArray,cosBool,cosDict,cosName,cosNumber,cosRef} from './packages/pdf-ast/src/ast.ts';
import {optionalContentVisibilitySteps} from './packages/pdf-ast/src/content/evaluator.ts';
import {appendStoredRecord,readStoredRecord} from './packages/pdf-ast/src/content/stored-record.ts';
import {StoredReferenceMembership} from './packages/pdf-ast/src/content/stored-reference-membership.ts';
export default {async fetch(request,env){
 const count=Number(new URL(request.url).searchParams.get('count'));let end=0,reads=0,id=0,live=0,admission=0,peakSet=0;
 const original=Set.prototype.add;Set.prototype.add=function(value){const result=original.call(this,value);peakSet=Math.max(peakSet,this.size);if(this.size>64)throw Error('resident layer set');return result;};
 const read=async(key,at,n)=>{if(n>4096)throw Error('large read');return new Uint8Array(await(await env.BACKING.fetch('https://backing/'+key+'?at='+at+'&length='+n)).arrayBuffer());};
 const write=async(key,at,bytes)=>{if(bytes.length>4096)throw Error('large write');await env.BACKING.fetch('https://backing/'+key+'?at='+at,{method:'PUT',body:bytes});};
 const storage={allocate(n){const at=end;end+=n;return at;},async read(at,n){reads++;return read('records',at,n);},write(at,bytes){return write('records',at,bytes);}};
 const scope={},files=new Map(),stat=(file)=>({type:'file',size:file.size,identityScope:scope,opaqueIdentity:file.id,opaqueVersion:'1'}),parent={type:'directory',size:0,identityScope:scope,opaqueIdentity:'root',opaqueVersion:'1'};
 const fs={capabilities:{retainedRead:true,retainedStagingWrite:true,retainedStagingCleanup:true},async stat(){return parent;},
 async createStagedFile(path,name){const file={id:String(++id),size:0},filePath=path+'/'+name;files.set(filePath,file);live++;return {parent:{path:'/',stat:parent},directory:{path,stat:parent},file:{path:filePath,stat:stat(file)},writer:{async write(bytes){await write(file.id,file.size,bytes);file.size+=bytes.length;},async finish(){return stat(file);}},cleanup:{async remove(){files.delete(filePath);live--;await env.BACKING.fetch('https://backing/'+file.id,{method:'DELETE'});},async close(){}}};},
 async openReadFile(path){const file=files.get(path);if(!file)throw Error('missing index');return {async stat(){return stat(file);},read(at,n){return read(file.id,at,n);},async close(){}};},readFile(){throw Error('whole read');},writeFile(){throw Error('whole write');}};
 const membership=new StoredReferenceMembership({fs,directory:'/'},undefined,n=>admission+=n);
 try{
  let position=-1,tail=-1;for(let i=1;i<=count;i++){tail=await appendStoredRecord(storage,cosRef(i),tail);if(position===-1)position=tail;}
  const array={kind:'array',items:[],storedItems:{storage,position,length:count}},catalog=cosDict({OCProperties:cosDict({D:cosDict({BaseState:cosName('OFF'),ON:array})})});
  const work=optionalContentVisibilitySteps(cosDict({Type:cosName('OCMD'),P:cosName('AllOn'),OCGs:array}));let step=work.next();
  while(!step.done){const r=step.value;let node;
   if(r.kind==='catalog')node=catalog;
   else if(r.kind==='resolve')node=r.node.kind==='ref'?cosDict({Type:cosName('OCG')}):r.node;
   else if(r.kind==='array-item'){const record=await readStoredRecord(r.items.storage,r.position);node=cosArray([cosNumber(record.next),record.value]);}
   else if(r.kind==='array-reference')node=cosBool(await membership.has(r.items,r.objectNumber));
   else throw Error('unexpected '+r.kind);
   step=work.next({kind:'resolved',node});
  }
  if(!step.value)throw Error('incorrect layer visibility');await membership.close();
  return Response.json({reads,live,admission,peakSet,node:typeof process!=='undefined'||typeof Buffer!=='undefined'});
 }finally{await membership.close();Set.prototype.add=original;}
}};`},bundle:true,write:false,platform:"browser",conditions:["workerd"],format:"esm",metafile:true,logLevel:"silent"});
  expect(Object.values(bundle.metafile!.outputs).flatMap(output=>output.imports)).toEqual([]);
  const runtime=new Miniflare({workers:[{name:"visibility",modules:true,compatibilityDate:"2026-07-01",cf:false,script:bundle.outputFiles[0]!.text,serviceBindings:{BACKING:"backing"}},
    {name:"backing",modules:true,compatibilityDate:"2026-07-01",cf:false,script:`const files=new Map();export default {async fetch(request){const url=new URL(request.url),key=url.pathname,at=Number(url.searchParams.get('at'));if(request.method==='DELETE'){files.delete(key);return new Response();}if(request.method==='PUT'){const bytes=new Uint8Array(await request.arrayBuffer()),old=files.get(key),end=at+bytes.length;let data=old;if(!data||data.length<end){data=new Uint8Array(Math.max(end,(old?.length??4096)*2));if(old)data.set(old);files.set(key,data);}data.set(bytes,at);return new Response();}return new Response(files.get(key).slice(at,at+Number(url.searchParams.get('length'))));}};`}]});
  try{
    for(const count of [128,512]){
      const response=await runtime.dispatchFetch("https://worker/?count="+count);if(response.status!==200)throw Error(await response.text());
      const result=await response.json() as {reads:number;live:number;admission:number;peakSet:number;node:boolean};
      expect(result.reads).toBeLessThanOrEqual(count*4);expect(result.live).toBe(0);expect(result.admission).toBe(32768);expect(result.peakSet).toBeLessThanOrEqual(64);expect(result.node).toBe(false);
    }
  }finally{await runtime.dispose();}
});
