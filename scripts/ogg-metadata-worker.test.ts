import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

const vendorLength=300000,valueLength=700000,smallCount=1500;
const pattern=Array.from(new TextEncoder().encode('TITLE=é😀,')),small=Array.from(new TextEncoder().encode('NAME=small!?'));
let goldenHash=2166136261;for(let i=0;i<valueLength;i++)goldenHash=Math.imul(goldenHash^pattern[i%pattern.length]!,16777619)>>>0;
for(let i=0;i<smallCount;i++)for(const byte of small)goldenHash=Math.imul(goldenHash^byte,16777619)>>>0;
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:"export {probeOggStreamSource} from '@poe-code/audio-ast';"},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const [codec,mode]=new URL(request.url).pathname.slice(1).split('/'),opus=codec==='opus',prefix=opus?8:7;
      const header=new Uint8Array(opus?19:30),view=new DataView(header.buffer),encoder=new TextEncoder();
      if(opus){header.set(encoder.encode('OpusHead'));header[8]=1;header[9]=2;view.setUint16(10,312,true);}else{header.set([1,...encoder.encode('vorbis')]);header[11]=2;view.setUint32(12,44100,true);header[29]=1;}
      const marker=opus?encoder.encode('OpusTags'):new Uint8Array([3,...encoder.encode('vorbis')]),pattern=${JSON.stringify(pattern)},small=${JSON.stringify(small)};
      const vendorStart=prefix+4,countOffset=vendorStart+${vendorLength},valueStart=countOffset+8,smallStart=valueStart+${valueLength},end=smallStart+${smallCount}*(4+small.length),size=end+(opus?0:1),controller=new AbortController();
      let reads=0,largestRead=0,largestAllocation=0,spans=0,total=0,hash=2166136261,error,result;
      const comments={size,async read(offset,length){
        reads++;largestRead=Math.max(largestRead,length);if(length>16384)throw new Error('Unbounded read');
        if(offset>=vendorStart&&offset<countOffset)throw new Error('Vendor payload read');
        if(reads===3&&mode==='source')throw new Error('source failure');if(reads===5&&mode==='cancel')controller.abort(new Error('cancelled read'));
        const bytes=new Uint8Array(length);for(let i=0;i<length;i++){const at=offset+i;
          if(at<prefix)bytes[i]=marker[at];else if(at<vendorStart)bytes[i]=${vendorLength}>>>((at-prefix)*8)&255;
          else if(at<countOffset)throw new Error('Vendor payload read');
          else if(at<countOffset+4)bytes[i]=${smallCount+1}>>>((at-countOffset)*8)&255;
          else if(at<valueStart)bytes[i]=${valueLength}>>>((at-countOffset-4)*8)&255;
          else if(at<smallStart)bytes[i]=pattern[(at-valueStart)%pattern.length];
          else if(at<end){const part=(at-smallStart)%(4+small.length);bytes[i]=part<4?small.length>>>(part*8)&255:small[part-4];}
          else bytes[i]=mode==='framing'?0:1;
        }return bytes;
      }};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>16384)throw new Error('Unbounded allocation');return bytes;}});
      try{result=await api.probeOggStreamSource({head:{size:header.length,async read(offset,length){return header.subarray(offset,offset+length);}},comments,granule:88200n,size:size+header.length},{signal:controller.signal,async checkpoint(){if(mode==='checkpoint')throw new Error('checkpoint failure');},async onComment(span){
        if(mode==='callback')throw new Error('callback failure');spans++;for(let at=0;at<span.length;at+=16384){const bytes=await comments.read(span.offset+at,Math.min(16384,span.length-at));controller.signal.throwIfAborted();total+=bytes.length;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;}
      }});}catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({result,spans,total,hash,largestRead,largestAllocation,error});
    }}
  `});
});
afterAll(async()=>{await runtime?.dispose();});
for(const codec of ['opus','vorbis'])for(const mode of ['ok','source','cancel','checkpoint','callback',...(codec==='vorbis'?['framing']:[])])it(`probes bounded ${codec} metadata in a Node-free Worker: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch(`https://example.test/${codec}/${mode}`)).json() as {result?:{codec:string;sampleRate:number;samples:number;tags:unknown};spans:number;total:number;hash:number;largestRead:number;largestAllocation:number;error?:string};
  expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(16384);
  if(mode==='ok'){expect(result.error).toBeUndefined();expect(result.result).toMatchObject({codec,sampleRate:codec==='opus'?48000:44100,samples:codec==='opus'?87888:88200,tags:{}});expect(result.spans).toBe(smallCount+1);expect(result.total).toBe(valueLength+smallCount*small.length);expect(result.hash).toBe(goldenHash);}
  else expect(result.error).toBe(mode==='source'?'source failure':mode==='cancel'?'cancelled read':mode==='checkpoint'?'checkpoint failure':mode==='callback'?'callback failure':'Missing Vorbis comment framing bit');
});
