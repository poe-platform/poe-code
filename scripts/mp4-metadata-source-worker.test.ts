import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll,beforeAll,expect,it } from 'vitest';
const value='é😀,"\n\r\\\t||'.repeat(65536);
const encoder=new TextEncoder();
function join(parts:Uint8Array[]){const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;}
function box(type:string,...parts:Uint8Array[]){const bytes=join([new Uint8Array(8),...parts]);new DataView(bytes.buffer).setUint32(0,bytes.length);for(let i=0;i<4;i++)bytes[4+i]=type.charCodeAt(i);return bytes;}
const chapterCount=2000,chapterParts=[new Uint8Array(13)];new DataView(chapterParts[0]!.buffer).setUint32(9,chapterCount);
for(let i=0;i<chapterCount;i++){const prefix=new Uint8Array(9);new DataView(prefix.buffer).setBigUint64(0,BigInt(i)*10000000n);prefix[8]=1;chapterParts.push(prefix,new Uint8Array([65]));}
const brand=encoder.encode('isom'.repeat(20000));
const input=join([box('ftyp',encoder.encode('isom'),new Uint8Array(4),brand),box('moov',box('udta',box('meta',new Uint8Array(4),box('ilst',box('©nam',box('data',new Uint8Array(8),encoder.encode(value),new Uint8Array(40000))))),box('chpl',...chapterParts))),new Uint8Array([0,0,0,1,109,100,97,116,0,0,1,0,0,0,0,0])]);

function expected(writer:string){
  const escape=(text:string,separator:string)=>{let result='';for(const character of text){if(character==='\n')result+='\\n';else if(character==='\r')result+='\\r';else if(character==='\\'||character===separator)result+='\\'+character;else result+=character;}return result;};
  const text=writer==='json:compact=1'?JSON.stringify({format:{tags:{title:value}}})+'\n':writer==='default'?'[FORMAT]\nTAG:title='+value+'\n[/FORMAT]\n':writer==='csv'?'format,"'+value.replaceAll('"','""')+'"\n':writer==='flat'?'format.tags.title="'+escape(value,'"')+'"\n':'format|tag:title='+escape(value,'|')+'\n';
  const bytes=new TextEncoder().encode(text);let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return [bytes.length,hash];
}
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`export {createFfprobeCommand} from 'safe-bash-command-ffprobe';export {mp4Ast,probeMp4MetadataSource,MediaBudgetTracker} from '@poe-code/mp4-ast';export {createCommandArguments} from 'safe-bash-contracts/command';export {MemoryFileSystem} from '@poe-code/safe-fs/core';export {createR2PagedFixture} from './scripts/pandoc-r2-storage.fixture.mjs';`},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const [mode,route,writer]=new URL(request.url).pathname.slice(1).split('/'),namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');await namespace.writeFile('/input.mp4',new Uint8Array());
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();let inputClosed=0,pluginClosed=0,retired=0,reads=0,total=0,hash=2166136261,largest=0,diagnostic='',error;
      async function inputRead(offset,length){if(length>16384)throw new Error('unbounded input');const object=await env.PAGES.get('input',{range:{offset,length}});return new Uint8Array(await object.arrayBuffer());}
      const fs=new Proxy(backing.fs,{get(target,key){
        if(key==='openReadFile')return async()=>({stat:async()=>({...await namespace.stat('/input.mp4'),size:${input.length-16}+2**40}),async read(offset,length){if(inputClosed)throw new Error('premature input close');if(offset+length>${input.length})throw new Error('media payload read');return inputRead(offset,length);},async close(){inputClosed++;}});
        if(key==='open')return async(...args)=>{const handle=await target.open(...args);return new Proxy(handle,{get(resource,name){if(name==='write')return async(...values)=>{if(mode==='write')throw new Error('backing write failed');if(mode==='cancel')controller.abort(new Error('cancelled text'));return resource.write(...values);};const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;}});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const plugin={...api.mp4Ast(),async probeRecords(source){
        const metadata=await api.probeMp4MetadataSource(source,${chapterCount},{signal:controller.signal,budget:new api.MediaBudgetTracker({maxInputBytes:2**41})});
        const original=metadata.tags.title;
        return{streams:[],chapters:metadata.chapters,format:{tags:{...metadata.tags,title:{kind:'text',async *chunks(){try{for await(const chunk of original.chunks()){reads++;if(mode==='source'&&reads===3)throw new Error('text source failed');yield chunk;}}finally{retired++;}}}}},async close(){pluginClosed++;if(mode==='close')throw new Error('plugin close failed');}};
      }};
      const Native=Uint8Array,stringify=JSON.stringify;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largest=Math.max(largest,bytes.length);if(bytes.length>65536)throw new Error('unbounded allocation');return bytes;}});
      JSON.stringify=function(value,...args){if(typeof value==='string'&&value.length>4096)throw new Error('unbounded string serialization');return stringify(value,...args);};
      let result;try{result=await api.createFfprobeCommand({asts:[plugin],limits:{maxInputBytes:2**41,maxOutputBytes:4000000}}).execute({command:'ffprobe',...api.createCommandArguments(['-f','mp4','-of',writer,...(mode==='chapters'?['-show_chapters']:['-show_entries',mode==='brands'?'format_tags=compatible_brands':'format_tags=title']),route==='stdin'?'-':'/input.mp4']),cwd:'/',env:{TMPDIR:'/spill'},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){try{for(let offset=0;offset<${input.length};offset+=16384)yield await inputRead(offset,Math.min(16384,${input.length}-offset));}finally{inputClosed++;}}},stdout:{async write(bytes){if(inputClosed!==1||pluginClosed!==1||(mode!=='chapters'&&mode!=='brands'&&retired<1))throw new Error('publication before cleanup');if(bytes.length>16384)throw new Error('unbounded output');for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;total+=bytes.length;}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;JSON.stringify=stringify;}
      return Response.json({exitCode:result?.exitCode,inputClosed,pluginClosed,retired,reads,total,hash,largest,diagnostic,error,events:backing.events,remaining:(await env.PAGES.list()).objects.filter(o=>o.key!=='input').length});
    }}
  `});await(await runtime.getR2Bucket('PAGES')).put('input',input);
});
afterAll(async()=>{await runtime?.dispose();});
for(const writer of ['json:compact=1','default','flat','compact','csv'])for(const route of ['retained','stdin'])it(`native MP4 text streams from R2 through ${writer}/${route}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/success/'+route+'/'+writer)).json() as Result;
  check(result);expect(result.exitCode,result.diagnostic||result.error).toBe(0);expect(result.retired).toBe(writer==='csv'?2:1);expect([result.total,result.hash]).toEqual(expected(writer));
});
for(const mode of ['source','write','close','cancel'])it(`native MP4 metadata retires backing before publication: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/'+mode+'/retained/json:compact=1')).json() as Result;
  check(result);expect(result.total).toBe(0);if(mode==='cancel')expect(result.error).toBe('cancelled text');else expect(result.diagnostic).toContain(mode==='source'?'text source failed':mode==='write'?'backing write failed':'plugin close failed');
});
type Result={exitCode?:number;inputClosed:number;pluginClosed:number;retired:number;reads:number;total:number;hash:number;largest:number;diagnostic:string;error?:string;events:{opened:number;closed:number;largestTransfer:number};remaining:number};
function check(result:Result){expect(result.inputClosed).toBe(1);expect(result.pluginClosed).toBe(1);expect(result.largest).toBeLessThanOrEqual(65536);expect(result.events.opened).toBe(result.events.closed);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.remaining).toBe(0);}

it('streams a large native chapter collection with exact independent JSON output',async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/chapters/retained/json:compact=1')).json() as Result;
  check(result);expect(result.exitCode,result.diagnostic||result.error).toBe(0);
  const chapters=Array.from({length:chapterCount},(_,id)=>({id,time_base:'1/1000',start:id*1000,start_time:id.toFixed(6),end:(id+1)*1000,end_time:(id+1).toFixed(6),tags:{title:'A'}}));
  const bytes=encoder.encode(JSON.stringify({chapters})+'\n');let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;
  expect([result.total,result.hash]).toEqual([bytes.length,hash]);expect(result.retired).toBe(0);
});

it('streams compatible brands without materializing their collection',async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/brands/retained/json:compact=1')).json() as Result;
  check(result);expect(result.exitCode,result.diagnostic||result.error).toBe(0);
  const bytes=encoder.encode(JSON.stringify({format:{tags:{compatible_brands:'isom'.repeat(20000)}}})+'\n');let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;
  expect([result.total,result.hash]).toEqual([bytes.length,hash]);expect(result.retired).toBe(0);
});
