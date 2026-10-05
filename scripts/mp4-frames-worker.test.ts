import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll,beforeAll,expect,it } from 'vitest';

const count=10000;
function words(values:number[]){const bytes=new Uint8Array(values.length*4),view=new DataView(bytes.buffer);values.forEach((value,i)=>view.setUint32(i*4,value>>>0));return bytes;}
function join(parts:Uint8Array[]){const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;}
function box(type:string,...parts:Uint8Array[]){const bytes=join([words([8+parts.reduce((n,p)=>n+p.length,0),0]),...parts]);bytes.set(new TextEncoder().encode(type),4);return bytes;}
function fixture(fragmented:boolean){
  const table=fragmented?box('stsz',words([0,0,0])):join([box('stts',words([0,1,count,2])),box('stsc',words([0,1,1,count,1])),box('stsz',words([0,3,count])),box('stco',words([0,1,1000000])),box('stss',words([0,count/2,...Array.from({length:count/2},(_,i)=>i*2+1)]))]);
  const visual=new Uint8Array(78);new DataView(visual.buffer).setUint16(24,640);new DataView(visual.buffer).setUint16(26,360);
  const config=new Uint8Array(100004);config.set([0x81,0,0x40]);
  const stsd=box('stsd',words([0,1]),box('av01',visual,box('av1C',config)));
  const moov=box('moov',box('trak',box('tkhd',words([0,0,0,9,0,count*2])),box('mdia',box('mdhd',words([0,0,0,1000,count*2,0])),box('hdlr',words([0,0,0x76696465])),box('minf',box('stbl',stsd,table)))));
  const fragment=fragmented?box('moof',box('traf',box('tfhd',words([0,9])),box('trun',words([0x00000f01,count,1000000,...Array.from({length:count},(_,i)=>[2,3,i%2?0x01010000:0x02000000,0]).flat()])))):new Uint8Array();
  const head=join([box('ftyp',words([0x69736f6d,512])),moov,fragment,words([1,0x6d646174,256,0])]);
  const name=fragmented?'trun':'stco',at=head.findIndex((_,i)=>[...name].every((c,j)=>head[i+j]===c.charCodeAt(0)));
  new DataView(head.buffer).setUint32(at+12,fragmented?head.length-(16+moov.length):head.length);
  // A large declared mdat is skipped for retained input and clipped for physical stdin.
  return {head,bytes:join([head,new Uint8Array(100000)])};
}
const fixtures={classic:fixture(false),fragmented:fixture(true)};
const packets=Array.from({length:count},(_,i)=>({codec_type:'video',stream_index:0,pts:i*2,pts_time:(i*2/1000).toFixed(6),dts:i*2,dts_time:(i*2/1000).toFixed(6),duration:2,duration_time:'0.002000',size:'3',pos:String(i*3),flags:i%2?'__':'K_'}));
const frames=Array.from({length:count},(_,i)=>({media_type:'video',stream_index:0,key_frame:i%2?0:1,pts:i*2,pts_time:(i*2/1000).toFixed(6),pkt_dts:i*2,pkt_dts_time:(i*2/1000).toFixed(6),best_effort_timestamp:i*2,best_effort_timestamp_time:(i*2/1000).toFixed(6),pkt_duration:2,pkt_duration_time:'0.002000',pkt_size:'3',width:640,height:360,pix_fmt:'yuv420p10le',pict_type:i%2?'P':'I'}));
function outputHash(text:string){const bytes=new TextEncoder().encode(text);let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return [bytes.length,hash];}
let runtime:Miniflare;
beforeAll(async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`export {createFfprobeCommand} from 'safe-bash-command-ffprobe';export {createCommandArguments} from 'safe-bash-contracts/command';export {MemoryFileSystem} from '@poe-code/safe-fs/core';export {createR2PagedFixture} from './scripts/pandoc-r2-storage.fixture.mjs';`},bundle:true,platform:'browser',conditions:['workerd'],format:'cjs',write:false,metafile:true,logLevel:'silent'});
  for(const output of Object.values(bundle.metafile!.outputs))expect(output.imports).toEqual([]);expect(Object.keys(bundle.metafile!.inputs).some(path=>path.startsWith('node:'))).toBe(false);
  runtime=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,r2Buckets:['PAGES'],script:`
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request,env){
      const [kind,route,mode,records,writer]=new URL(request.url).pathname.slice(1).split('/'),headSize=kind==='classic'?${fixtures.classic.head.length}:${fixtures.fragmented.head.length},physical=headSize+100000;
      const namespace=new api.MemoryFileSystem();await namespace.mkdir('/spill');await namespace.writeFile('/input.mp4',new Uint8Array());
      const backing=api.createR2PagedFixture(namespace,env.PAGES),controller=new AbortController();let inputClosed=0,reads=0,largest=0,total=0,hash=2166136261,diagnostic='',error;
      async function read(offset,length){reads++;if(length>16384)throw new Error('unbounded read');if(mode==='source'&&reads>20)throw new Error('source failed');const object=await env.PAGES.get('input/'+kind,{range:{offset,length}});return new Uint8Array(await object.arrayBuffer());}
      const fs=new Proxy(backing.fs,{get(target,key){
        if(key==='openReadFile')return async()=>({stat:async()=>({...await namespace.stat('/input.mp4'),size:headSize-16+2**40}),async read(offset,length){if(inputClosed||offset+length>headSize)throw new Error('payload or closed read');return read(offset,length);},async close(){inputClosed++;if(mode==='close')throw new Error('input close failed');}});
        if(key==='open')return async(...args)=>{const handle=await target.open(...args);return new Proxy(handle,{get(resource,name){if(name==='write')return async(...values)=>{if(mode==='write')throw new Error('backing write failed');if(mode==='cancel')controller.abort(new Error('cancelled frames'));return resource.write(...values);};const value=Reflect.get(resource,name,resource);return typeof value==='function'?value.bind(resource):value;}});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const Native=Uint8Array;globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largest=Math.max(largest,bytes.length);if(bytes.length>65536)throw new Error('unbounded allocation');return bytes;}});
      let result;try{result=await api.createFfprobeCommand({limits:{maxInputBytes:2**41,maxOutputBytes:8000000}}).execute({command:'ffprobe',...api.createCommandArguments(['-f','mp4',...(records==='mixed'?['-show_packets']:[]),...(writer?['-show_entries','frame=stream_index,pts,pkt_size']:['-show_frames']),'-of',writer||'json:compact=1',route==='stdin'?'-':'/input.mp4']),cwd:'/',env:{TMPDIR:'/spill'},fs,signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){try{for(let at=0;at<physical;at+=16384)yield await read(at,Math.min(16384,physical-at));}finally{inputClosed++;}}},stdout:{async write(bytes){if(inputClosed!==1)throw new Error('publication before input close');if(bytes.length>16384)throw new Error('unbounded output');for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;total+=bytes.length;}},stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});}catch(cause){error=cause.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({exitCode:result?.exitCode,inputClosed,reads,largest,total,hash,diagnostic,error,events:backing.events,remaining:(await env.PAGES.list()).objects.filter(o=>!o.key.startsWith('input/')).length});
    }}
  `});
  const bucket=await runtime.getR2Bucket('PAGES');for(const [name,{bytes}]of Object.entries(fixtures))await bucket.put('input/'+name,bytes);
});
afterAll(async()=>{await runtime?.dispose();});
for(const kind of ['classic','fragmented'])for(const route of ['retained','stdin'])for(const records of ['frames','mixed'])it(`native MP4 frame records use bounded R2 storage: ${kind}/${route}/${records}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/'+kind+'/'+route+'/success/'+records)).json() as Result;
  check(result);expect(result.exitCode,result.diagnostic||result.error).toBe(0);expect([result.total,result.hash]).toEqual(outputHash(JSON.stringify(records==='mixed'?{packets,frames}:{frames})+'\n'));
});
for(const writer of ['json:compact=1','default','compact','csv','flat'])for(const route of ['retained','stdin'])it(`selected MP4 frame fields use bounded R2 storage: ${writer}/${route}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/classic/'+route+'/success/frames/'+writer)).json() as Result;
  const rows=Array.from({length:count},(_,i)=>({stream_index:0,pts:i*2,pkt_size:'3'}));
  const text=writer.startsWith('json')?JSON.stringify({frames:rows})+'\n':rows.map((row,i)=>{
    if(writer==='csv')return `frame,0,${row.pts},3\n`;
    if(writer==='compact')return `frame|stream_index=0|pts=${row.pts}|pkt_size=3\n`;
    if(writer==='flat')return `frames.frame.${i}.stream_index=0\nframes.frame.${i}.pts=${row.pts}\nframes.frame.${i}.pkt_size="3"\n`;
    return `[FRAME]\nstream_index=0\npts=${row.pts}\npkt_size=3\n[/FRAME]\n`;
  }).join('');
  check(result);expect(result.exitCode,result.diagnostic||result.error).toBe(0);expect([result.total,result.hash]).toEqual(outputHash(text));
});
for(const mode of ['source','write','close','cancel'])it(`native MP4 frames clean up without publication: ${mode}`,async()=>{
  const result=await(await runtime.dispatchFetch('https://example.test/classic/retained/'+mode+'/frames')).json() as Result;
  check(result);expect(result.total).toBe(0);if(mode==='cancel')expect(result.error).toBe('cancelled frames');else expect(result.diagnostic).toContain(mode==='source'?'source failed':mode==='write'?'backing write failed':'input close failed');
});
type Result={exitCode?:number;inputClosed:number;reads:number;largest:number;total:number;hash:number;diagnostic:string;error?:string;events:{opened:number;closed:number;largestTransfer:number};remaining:number};
function check(result:Result){expect(result.inputClosed).toBe(1);expect(result.largest).toBeLessThanOrEqual(65536);expect(result.events.largestTransfer).toBeLessThanOrEqual(16384);expect(result.events.closed).toBe(result.events.opened);expect(result.remaining).toBe(0);}
