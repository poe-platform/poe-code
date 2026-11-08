import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

const pages: { start: number; size: number; header: number[] }[] = [];
let size = 0;
function page(length: number, lacing: number[], serial: number, sequence: number, flags: number) {
  const bytes = new Uint8Array(27 + lacing.length + length), view = new DataView(bytes.buffer);
  bytes.set([79,103,103,83,0,flags]);view.setUint32(14,serial,true);view.setUint32(18,sequence,true);bytes[26]=lacing.length;bytes.set(lacing,27);bytes.fill(23,27+lacing.length);
  let crc=0;for(const byte of bytes){crc^=byte<<24;for(let bit=0;bit<8;bit++)crc=crc<<1^(crc&0x80000000?0x04c11db7:0);}view.setUint32(22,crc>>>0,true);
  pages.push({start:size,size:bytes.length,header:Array.from(bytes.subarray(0,27+lacing.length))});size+=bytes.length;
}
let sequence=0;
for(let packet=0;packet<2;packet++)for(let at=0;at<200000;){const length=Math.min(65025,200000-at),last=at+length===200000,lacing=Array.from({length:Math.floor(length/255)},()=>255);if(last)lacing.push(length%255);page(length,lacing,0,sequence++,(at?1:0)|(packet===0&&at===0?2:0)|(packet===1&&last?4:0));at+=length;}
for(let i=1;i<=600;i++)page(1,[1],i,0,6);
let runtime: Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
    export { OggIndex } from './packages/safe-bash-command-ffprobe/src/ogg-index.js';
    export { MemoryFileSystem } from '@poe-code/safe-fs/core';
    export { createR2PagedFixture } from './scripts/pandoc-r2-storage.fixture.mjs';
  `},bundle:true,platform:"browser",conditions:["workerd"],format:"cjs",write:false,metafile:true,logLevel:"silent"});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith("node:"))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:"2026-07-01",cf:false,r2Buckets:["PAGES"],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),pages=${JSON.stringify(pages)},namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      let scanned=false,streams=0,total=0,largestAllocation=0,largestRead=0,error;
      const source={size:${size},async read(offset,length){
        largestRead=Math.max(largestRead,length);if(length>16384)throw new Error('Unbounded source read');
        if(scanned&&mode==='source')throw new Error('replay read failed');if(scanned&&mode==='cancel')controller.abort(new Error('cancelled replay'));
        const bytes=new Uint8Array(length);let index=0;while(pages[index].start+pages[index].size<=offset)index++;
        for(let i=0;i<length;i++){while(pages[index].start+pages[index].size<=offset+i)index++;const page=pages[index],at=offset+i-page.start;bytes[i]=at<page.header.length?page.header[at]:23;}return bytes;
      }};
      const fs=new Proxy(backing.fs,{get(target,key){if(key==='open')return async(...args)=>{const handle=await target.open(...args);return new Proxy(handle,{get(resource,name){
        if(name==='read'||name==='write')return async(...values)=>{if(mode===name)throw new Error('backing '+name+' failed');return resource[name](...values);};
        if(name==='close')return async()=>{await resource.close();if(mode==='close')throw new Error('backing close failed');};
        const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;
      }});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>65536)throw new Error('Unbounded allocation');return bytes;}});
      const index=new api.OggIndex(source,{fs,cwd:'/',env:{TMPDIR:'/spill'},signal:controller.signal});
      try{await index.scan();scanned=true;for await(const stream of index.streams()){streams++;for(const packet of [stream.head,stream.comments])if(packet)for(let at=0;at<packet.size;){const bytes=await packet.read(at,16384);if(!bytes.length||!bytes.every(byte=>byte===23))throw new Error('Bad packet replay');at+=bytes.length;total+=bytes.length;}if(mode==='return')break;}}
      catch(cause){error=cause.message;}
      finally{try{await index.close();}catch(cause){error??=cause.message;}globalThis.Uint8Array=Native;}
      return Response.json({streams,total,error,largestAllocation,largestRead,events:backing.events,remaining:(await env.PAGES.list()).objects.length});
    }}
  `});
});
afterAll(async()=>{await runtime?.dispose();});
for(const mode of ["ok","read","write","close","source","cancel","return"])it(`retains Ogg packet state and spans on R2: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch(`https://example.test/${mode}`)).json() as {streams:number;total:number;error?:string;largestAllocation:number;largestRead:number;events:{opened:number;closed:number;largestTransfer:number};remaining:number};
  expect(result.largestAllocation).toBeLessThanOrEqual(65536);expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);
  expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);
  if(mode==='ok'||mode==='return'){expect(result.error).toBeUndefined();expect(result.streams).toBe(mode==='ok'?601:1);expect(result.total).toBe(mode==='ok'?400600:400000);}
  else expect(result.error).toBe(mode==='source'?'replay read failed':mode==='cancel'?'cancelled replay':`backing ${mode} failed`);
});
