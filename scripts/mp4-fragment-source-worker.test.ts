import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

const count = 20000, length = 16 + 12 + 20 + count * 16;
const input = new Uint8Array(length), view = new DataView(input.buffer);
function header(offset: number, size: number, name: string) {
  view.setUint32(offset,size); for(let i=0;i<4;i++) input[offset+4+i]=name.charCodeAt(i);
}
header(0,16,'tfhd'); view.setUint32(12,9);
header(16,12,'free');
header(28,20+count*16,'trun'); view.setUint32(36,0x01000f01); view.setUint32(40,count); view.setInt32(44,1000000);
for(let i=0;i<count;i++) { const offset=48+i*16; view.setUint32(offset,2+i%3); view.setUint32(offset+4,3+i%4); view.setUint32(offset+8,i%2?0x01010000:0x02000000); view.setInt32(offset+12,i%2?-2:1); }
let runtime: Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:"export {scanMp4Fragment,MediaBudgetTracker} from '@poe-code/mp4-ast';"},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const mode=new URL(request.url).pathname.slice(1),controller=new AbortController();
      let count=0,offset=1000000,dts=17,largestRead=0,largestAllocation=0,reads=0,error,final;
      const source={size:1090000,async read(at,length){
        reads++;largestRead=Math.max(largestRead,length);
        if(length>16384||at+length>${length})throw new Error('Payload or unbounded read');
        if(count&&mode==='source')throw new Error('source failure');
        if(count&&mode==='cancel')controller.abort(new Error('cancelled replay'));
        const object=await env.PAGES.get('input',{range:{offset:at,length}});return new Uint8Array(await object.arrayBuffer());
      }};
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>16384)throw new Error('Unbounded allocation');return bytes;}});
      const budget=new api.MediaBudgetTracker({maxMemoryBytes:mode==='memory'?16383:16384});
      let checkpoints=0;
      try {
        const iterator=api.scanMp4Fragment(source,{offset:0,length:${length},depth:2},{trackId:9,moofOffset:0,type:'video',defaults:{defaultSampleDescriptionIndex:1,defaultSampleDuration:0,defaultSampleSize:0,defaultSampleFlags:0},state:{dts:17,sampleCount:3},signal:controller.signal,budget,checkpoint:async()=>{checkpoints++;}});
        let next=await iterator.next();
        while(!next.done){
          const sample=next.value,size=3+count%4,duration=2+count%3,cts=count%2?-2:1;
          if(sample.offset!==offset||sample.size!==size||sample.dts!==dts||sample.pts!==dts+cts||sample.cts!==cts||sample.duration!==duration||sample.isKeyframe!==(count%2===0)||sample.sampleDescriptionIndex!==1)throw new Error('Incorrect sample '+count);
          offset+=size;dts+=duration;count++;
          if(mode==='return'){const before=reads;await iterator.return({dts:0,sampleCount:0});if(reads!==before)throw new Error('Read on return');break;}
          next=await iterator.next();
        }
        if(next.done)final=next.value;
      } catch(cause) {error=cause.message;} finally {globalThis.Uint8Array=Native;}
      return Response.json({count,offset,dts,error,final,largestRead,largestAllocation,reads,checkpoints,memory:budget.getStats().currentMemoryBytes});
    }}
  `});
  const bucket=await runtime.getR2Bucket('PAGES'); await bucket.put('input',input);
});
afterAll(async()=>{await runtime?.dispose();});
for(const mode of ['ok','source','cancel','return','memory']) it(`streams fragmented MP4 from R2 in a Node-free Worker: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/'+mode)).json() as {count:number;offset:number;dts:number;error?:string;final?:{dts:number;sampleCount:number};largestRead:number;largestAllocation:number;reads:number;checkpoints:number;memory:number};
  expect(result.largestRead).toBeLessThanOrEqual(16384);expect(result.largestAllocation).toBeLessThanOrEqual(16384);expect(result.memory).toBe(0);
  if(mode==='ok') {expect(result.error).toBeUndefined();expect(result.count).toBe(count);expect(result.offset).toBe(1090000);expect(result.dts).toBe(60016);expect(result.final).toEqual({dts:60016,sampleCount:20003});expect(result.reads).toBeLessThan(100);expect(result.checkpoints).toBeGreaterThan(100);}
  else if(mode==='return') {expect(result.error).toBeUndefined();expect(result.count).toBe(1);}
  else if(mode==='memory') expect(result.error).toContain('maxMemoryBytes');
  else expect(result.error).toBe(mode==='source'?'source failure':'cancelled replay');
});
