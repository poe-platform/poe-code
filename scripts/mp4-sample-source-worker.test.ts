import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

const count=20000, input=new Uint8Array(200000),tables:Record<string,{payloadOffset:number;payloadSize:number}>={};let used=0;
function table(name:string,words:number[]){const length=4+words.length*4,view=new DataView(input.buffer,used,length);words.forEach((word,i)=>view.setUint32(4+i*4,word));tables[name]={payloadOffset:used,payloadSize:length};used+=length;}
table('stsz',[0,count,...Array.from({length:count},(_,i)=>3+i%4)]);
table('stts',[2,count/2,2,count/2,3]);table('ctts',[1,count,1]);table('stsc',[1,1,count,1]);table('stco',[1,1000000]);table('stss',[count/2,...Array.from({length:count/2},(_,i)=>2*i+1)]);
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`export {scanMp4SampleTable} from '@poe-code/mp4-ast';export {MemoryFileSystem} from '@poe-code/safe-fs/core';export {PagedStorage,IntegerTable} from '@poe-code/safe-fs/storage';export {createR2PagedFixture} from './scripts/pandoc-r2-storage.fixture.mjs';`},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();
      let count=0,offset=1000000,dts=0,largestRead=0,largestAllocation=0,cached=-1,page,error;
      const source={size:1090000,async read(at,length){largestRead=Math.max(largestRead,length);if(length>16384||at+length>${used})throw new Error('Payload or unbounded read');if(count&&mode==='source')throw new Error('source failure');if(count&&mode==='cancel')controller.abort(new Error('cancelled replay'));
        const bytes=new Uint8Array(length);let used=0;while(used<length){const number=Math.floor((at+used)/16384);if(cached!==number){const object=await env.PAGES.get('input/'+number);page=new Uint8Array(await object.arrayBuffer());cached=number;}const start=(at+used)%16384,take=Math.min(length-used,page.length-start);bytes.set(page.subarray(start,start+take),used);used+=take;}return bytes;}};
      const fs=new Proxy(backing.fs,{get(target,key){if(key==='open')return async(...args)=>{const handle=await target.open(...args);return new Proxy(handle,{get(resource,name){if(name==='read'||name==='write')return async(...values)=>{if(mode===name)throw new Error('backing '+name+' failed');return resource[name](...values);};if(name==='close')return async()=>{await resource.close();if(mode==='close')throw new Error('backing close failed');};const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;}});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>65536)throw new Error('Unbounded allocation');return bytes;}});
      const storage=new api.PagedStorage({fs,cwd:'/',env:{TMPDIR:'/spill'},signal:controller.signal},4),keys=new api.IntegerTable(storage,128);
      try{for await(const sample of api.scanMp4SampleTable(source,${JSON.stringify(tables)},{signal:controller.signal,syncSamples:{add:n=>keys.set(BigInt(n),1n),has:async n=>(await keys.get(BigInt(n)))===1n}})){
        const size=3+count%4,duration=count<10000?2:3;
        if(sample.offset!==offset||sample.size!==size||sample.dts!==dts||sample.pts!==dts+1||sample.cts!==1||sample.duration!==duration||sample.isKeyframe!==(count%2===0)||sample.sampleDescriptionIndex!==1)throw new Error('Incorrect sample '+count);
        offset+=size;dts+=duration;count++;if(mode==='return')break;
      }}catch(cause){error=cause.message;}finally{try{await storage.close();}catch(cause){error??=cause.message;}globalThis.Uint8Array=Native;}
      return Response.json({count,offset,dts,error,largestRead,largestAllocation,events:backing.events,remaining:(await env.PAGES.list({limit:1000})).objects.filter(object=>!object.key.startsWith('input/')).length});
    }}
  `});
  const bucket=await runtime.getR2Bucket('PAGES');for(let at=0;at<used;at+=16384)await bucket.put('input/'+Math.floor(at/16384),input.subarray(at,Math.min(used,at+16384)));
});
afterAll(async()=>{await runtime?.dispose();});
for(const mode of ['ok','read','write','close','source','cancel','return'])it(`replays MP4 sample tables with caller R2 membership: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/'+mode)).json() as {count:number;offset:number;dts:number;error?:string;largestRead:number;largestAllocation:number;events:{opened:number;closed:number;largestTransfer:number};remaining:number};
  expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(65536);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.events.opened).toBeGreaterThan(0);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);
  if(mode==='ok'){expect(result.error).toBeUndefined();expect(result.count).toBe(count);expect(result.offset).toBe(1090000);expect(result.dts).toBe(50000);}
  else if(mode==='return'){expect(result.error).toBeUndefined();expect(result.count).toBe(1);}
  else expect(result.error).toBe(mode==='source'?'source failure':mode==='cancel'?'cancelled replay':`backing ${mode} failed`);
});
