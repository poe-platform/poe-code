import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { encodeOgg } from "../packages/audio-ast/src/ogg.js";
import { probe } from "../packages/safe-bash-command-ffprobe/src/probe.js";

const encoder=new TextEncoder();
function comments(fields:string[],opus:boolean){const prefix=opus?encoder.encode('OpusTags'):Uint8Array.from([3,...encoder.encode('vorbis')]);const strings=fields.map(field=>encoder.encode(field));const bytes=new Uint8Array(prefix.length+8+strings.reduce((n,b)=>n+4+b.length,0)+(opus?0:1)),view=new DataView(bytes.buffer);bytes.set(prefix);view.setUint32(prefix.length+4,strings.length,true);let at=prefix.length+8;for(const text of strings){view.setUint32(at,text.length,true);at+=4;bytes.set(text,at);at+=text.length;}if(!opus)bytes[at]=1;return bytes;}
function head(opus:boolean){const bytes=new Uint8Array(opus?19:30),view=new DataView(bytes.buffer);if(opus){bytes.set(encoder.encode('OpusHead'));bytes[8]=1;bytes[9]=2;view.setUint16(10,312,true);}else{bytes.set([1,...encoder.encode('vorbis')]);bytes[11]=2;view.setUint32(12,44100,true);bytes[29]=1;}return bytes;}
const picture=new Uint8Array(100032);new DataView(picture.buffer).setUint32(28,100000);
const fields=['title='+ 'é😀,"x"\n'.repeat(30000),'title=again','TITLE=upper','METADATA_BLOCK_PICTURE=!!!',...Array.from({length:1500},(_,i)=>'key'+i+'=value'+i)];
const bytes=encodeOgg([true,false].flatMap((opus,i)=>[
  {data:head(opus),serial:i+1,granule:0n,bos:true,eos:false},
  {data:comments(opus?fields:['ARTIST=last','metadata_block_picture='+Buffer.from(picture).toString('base64')],opus),serial:i+1,granule:0n,bos:false,eos:false},
  {data:Uint8Array.of(1),serial:i+1,granule:48000n,bos:false,eos:true}
]));
const writers=['json','default','flat','compact:s=||','csv:s=||'];
function fingerprint(text:string){const bytes=encoder.encode(text);let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return[bytes.length,hash];}
const golden=Object.fromEntries(['retained','stdin','stream'].flatMap(route=>writers.map(writer=>[route+writer,fingerprint(probe(bytes,['-of',writer,'-show_streams','-show_format',route==='stdin'?'-':'/input.ogg']))])));
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`export {createFfprobeCommand} from 'safe-bash-command-ffprobe';export {createCommandArguments} from 'safe-bash-contracts/command';export {MemoryFileSystem} from '@poe-code/safe-fs/core';export {createR2PagedFixture} from './scripts/pandoc-r2-storage.fixture.mjs';`},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const url=new URL(request.url),route=url.searchParams.get('route'),mode=url.searchParams.get('mode'),writer=url.searchParams.get('writer');
      const namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');await namespace.writeFile('/input.ogg',new Uint8Array(1));
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      let cached=-1,page,starts=0,inputClosed=false,total=0,hash=2166136261,largestAllocation=0,largestRead=0,diagnostic='',thrown,result;
      async function range(offset,length){largestRead=Math.max(largestRead,length);if(length>16384)throw new Error('Unbounded source read');
        if(offset===349&&++starts===2){if(mode==='late-read')throw new Error('late source read failed');if(mode==='cancel')controller.abort(new Error('cancelled tag replay'));}
        const bytes=new Uint8Array(length);let used=0;while(used<length){const number=Math.floor((offset+used)/16384);if(cached!==number){const object=await env.PAGES.get('input/'+number);page=new Uint8Array(await object.arrayBuffer());cached=number;}const start=(offset+used)%16384,take=Math.min(length-used,page.length-start);bytes.set(page.subarray(start,start+take),used);used+=take;}return bytes;
      }
      async function* input(){try{for(let at=0;at<${bytes.length};at+=16384)yield await range(at,Math.min(16384,${bytes.length}-at));}finally{inputClosed=true;}}
      const capabilities={...backing.fs.capabilities,retainedRead:false,streamingRead:true};
      const fs=new Proxy(backing.fs,{get(target,key){
        if(route==='stream'){if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;if(key==='openReadFile')return undefined;if(key==='readStream')return()=>input();}
        if(key==='readFile')return()=>{throw new Error('Whole input forbidden');};
        if(key==='openReadFile')return async()=>({stat:async()=>({...await namespace.stat('/input.ogg'),size:${bytes.length}}),read:range,close:async()=>{inputClosed=true;}});
        if(key==='open')return async(...args)=>{const handle=await target.open(...args);return new Proxy(handle,{get(resource,name){if(name==='read'||name==='write')return async(...values)=>{if(mode===name)throw new Error('backing '+name+' failed');return resource[name](...values);};if(name==='close')return async()=>{await resource.close();if(mode==='close')throw new Error('backing close failed');};const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;}});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=Uint8Array,stringify=JSON.stringify;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,value.length);if(value.length>65536)throw new Error('Unbounded allocation');return value;}});JSON.stringify=(value,...args)=>{if(typeof value==='string'&&value.length>32768)throw new Error('Unbounded string');return stringify(value,...args);};
      try{result=await api.createFfprobeCommand({limits:{maxInputBytes:${bytes.length},maxOutputBytes:mode==='limit'?100000:4000000}}).execute({command:'ffprobe',...api.createCommandArguments(['-of',writer,'-show_streams','-show_format',route==='stdin'?'-':'/input.ogg']),cwd:'/',env:{TMPDIR:'/spill'},fs,signal:controller.signal,stdin:route==='stdin'?input():{async *[Symbol.asyncIterator](){}},stdout:{async write(chunk){if(!inputClosed)throw new Error('Input still open');if(mode==='sink'){const error=new Error('sink failed');error.code='EPIPE';throw error;}total+=chunk.length;for(const byte of chunk)hash=Math.imul(hash^byte,16777619)>>>0;}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});}
      catch(error){thrown={message:error.message,code:error.code};}finally{globalThis.Uint8Array=Native;JSON.stringify=stringify;}
      return Response.json({code:result?.exitCode,total,hash,diagnostic,thrown,inputClosed,largestRead,largestAllocation,events:backing.events,remaining:(await env.PAGES.list({limit:1000})).objects.filter(object=>!object.key.startsWith('input/')).length});
    }}
  `});
  const bucket=await runtime.getR2Bucket('PAGES');for(let at=0;at<bytes.length;at+=16384)await bucket.put('input/'+Math.floor(at/16384),bytes.subarray(at,Math.min(bytes.length,at+16384)));
});
afterAll(async()=>{await runtime?.dispose();});
const cases=[...['retained','stdin','stream'].flatMap(route=>writers.map(writer=>({route,writer,mode:'success'}))),...['read','write','close','late-read','cancel','limit','sink'].map(mode=>({route:'retained',writer:'json',mode}))];
for(const {route,writer,mode}of cases)it(`streams Ogg metadata with external R2 storage: ${route}/${writer}/${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/?'+new URLSearchParams({route,writer,mode}))).json() as {code?:number;total:number;hash:number;diagnostic:string;thrown?:{message:string;code?:string};inputClosed:boolean;largestRead:number;largestAllocation:number;events:{opened:number;closed:number;largestTransfer:number};remaining:number};
  expect(result.inputClosed).toBe(true);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);
  if(mode==='success'){expect(result.code,result.diagnostic).toBe(0);expect([result.total,result.hash]).toEqual(golden[route+writer]);expect(result.events.opened).toBeGreaterThan(0);}
  else{expect(result.total).toBe(0);if(mode==='cancel')expect(result.thrown?.message).toBe('cancelled tag replay');else if(mode==='sink')expect(result.thrown?.code).toBe('EPIPE');else{expect(result.code).toBe(1);expect(result.diagnostic).toContain(mode==='limit'?'maxOutputBytes':mode==='late-read'?'late source read failed':`backing ${mode} failed`);}}
});
