import { expect, it } from "vitest";
import * as api from "./index.js";
import { encodeOgg } from "./ogg.js";
import { encodeComments } from "./vorbis.js";

const encoder = new TextEncoder();
function fixture(codec: "opus" | "vorbis") {
  const head = new Uint8Array(codec === "opus" ? 19 : 30), view = new DataView(head.buffer);
  if (codec === "opus") { head.set(encoder.encode("OpusHead"));head[8]=1;head[9]=2;view.setUint16(10,312,true);view.setUint32(12,44100,true); }
  else {head.set([1,...encoder.encode("vorbis")]);head[11]=2;view.setUint32(12,44100,true);head[28]=0x88;head[29]=1;}
  const prefix = codec === "opus" ? encoder.encode("OpusTags") : Uint8Array.from([3,...encoder.encode("vorbis")]);
  const tags=encodeComments({title:"a\nb",artist:"é😀",EMPTY:""},"vendor"), comments=new Uint8Array(prefix.length+tags.length+(codec==='vorbis'?1:0));
  comments.set(prefix);comments.set(tags,prefix.length);if(codec==='vorbis')comments[comments.length-1]=1;
  const granule=88200n;
  const bytes=encodeOgg([{data:head,serial:7,granule:0n,bos:true,eos:false},{data:comments,serial:7,granule:0n,bos:false,eos:false},{data:Uint8Array.of(1),serial:7,granule,bos:false,eos:true}]);
  return {head,comments,granule,size:bytes.length,bytes};
}
const source=(bytes:Uint8Array)=>({size:bytes.length,async read(offset:number,length:number){return bytes.subarray(offset,offset+length);}});
for(const codec of ['opus','vorbis'] as const)it(`preserves ${codec} timing and raw comment names through packet sources`,async()=>{
  expect(api.probeOggStreamSource).toBeTypeOf('function');
  const f=fixture(codec),result=await api.probeOggStreamSource({head:source(f.head),comments:source(f.comments),granule:f.granule,size:f.size});
  expect(result).toEqual(api.parseAudio(f.bytes).streams[0]);expect(result.tags!.TITLE).toBe('a;b');
});
it('exposes large comment spans without reading vendor or values',async()=>{
  expect(api.probeOggStreamSource).toBeTypeOf('function');
  const f=fixture('opus'),length=1000000,comments=new Uint8Array(8+4+length+4+4+length);
  comments.set(encoder.encode('OpusTags'));const view=new DataView(comments.buffer);view.setUint32(8,length,true);view.setUint32(12+length,1,true);view.setUint32(16+length,length,true);
  const reads:number[][]=[],spans:unknown[]=[];
  const result=await api.probeOggStreamSource({head:source(f.head),comments:{size:comments.length,async read(offset,size){reads.push([offset,size]);expect(size).toBeLessThanOrEqual(8);return comments.subarray(offset,offset+size);}},granule:f.granule,size:comments.length+f.head.length},{onComment:async span=>{spans.push(span);}});
  expect(result.tags).toEqual({});expect(spans).toEqual([{offset:20+length,length}]);
  expect(reads).toEqual([[0,8],[8,4],[12+length,4],[16+length,4]]);
});
it('handles borrowed short reads and bounded extended Opus identification',async()=>{
  expect(api.probeOggStreamSource).toBeTypeOf('function');
  const f=fixture('opus'),borrowed=new Uint8Array(3);let largest=0;
  const result=await api.probeOggStreamSource({head:{size:1000000,async read(offset,length){largest=Math.max(largest,length);const take=Math.min(length,3);borrowed.fill(0);borrowed.set(f.head.subarray(offset,offset+take));return borrowed.subarray(0,take);}},comments:source(f.comments),granule:f.granule,size:1001000});
  expect(largest).toBeLessThanOrEqual(276);expect(result.codec).toBe('opus');expect(result.samples).toBe(Number(f.granule)-312);
});
for(const kind of ['version','channels','mapping','vorbis-length','vorbis-version','vorbis-framing','comments','count','vendor','value','comment-framing','granule'] as const)it(`rejects invalid ${kind}`,async()=>{
  expect(api.probeOggStreamSource).toBeTypeOf('function');
  const f=fixture(kind.startsWith('vorbis')||kind==='comment-framing'?'vorbis':'opus');
  if(kind==='version')f.head[8]=16;
  if(kind==='channels')f.head[9]=3;
  if(kind==='mapping')f.head[18]=1;
  if(kind==='vorbis-length')f.head=f.head.slice(0,29);
  if(kind==='vorbis-version')f.head[7]=1;
  if(kind==='vorbis-framing')f.head[29]=0;
  if(kind==='comments')f.comments[0]=0;
  if(kind==='count')new DataView(f.comments.buffer).setUint32(18,0xffffffff,true);
  if(kind==='vendor')new DataView(f.comments.buffer).setUint32(8,0xffffffff,true);
  if(kind==='value')new DataView(f.comments.buffer).setUint32(22,0xffffffff,true);
  if(kind==='comment-framing')f.comments[f.comments.length-1]=0;
  if(kind==='granule')f.granule=BigInt(Number.MAX_SAFE_INTEGER)+1n;
  await expect(api.probeOggStreamSource({head:source(f.head),comments:source(f.comments),granule:f.granule,size:f.size})).rejects.toThrow();
});
it('propagates source/callback/checkpoint failures and cancellation after await',async()=>{
  expect(api.probeOggStreamSource).toBeTypeOf('function');
  const f=fixture('opus'),error=new Error('injected failure'),input={head:source(f.head),comments:source(f.comments),granule:f.granule,size:f.size};
  await expect(api.probeOggStreamSource({...input,head:{size:19,async read(){throw error;}}})).rejects.toBe(error);
  await expect(api.probeOggStreamSource(input,{onComment:async()=>{throw error;}})).rejects.toBe(error);
  await expect(api.probeOggStreamSource(input,{checkpoint:async()=>{throw error;}})).rejects.toBe(error);
  const controller=new AbortController();
  await expect(api.probeOggStreamSource(input,{signal:controller.signal,onComment:async()=>{controller.abort(error);}})).rejects.toBe(error);
});

it('preserves mapped Opus channel counts, raw case and empty duplicate semantics',async()=>{
  const f=fixture('opus'),head=new Uint8Array(276);head.set(f.head);head[9]=255;head[18]=1;
  const fields=['title=first','TITLE=','TITLE=second','TITLE=third','title=last','EMPTY=','EMPTY='];
  const payloads=fields.map(value=>encoder.encode(value)),length=16+payloads.reduce((n,p)=>n+4+p.length,0),comments=new Uint8Array(length),view=new DataView(comments.buffer);
  comments.set(encoder.encode('OpusTags'));view.setUint32(12,fields.length,true);let offset=16;
  for(const field of payloads){view.setUint32(offset,field.length,true);offset+=4;comments.set(field,offset);offset+=field.length;}
  const result=await api.probeOggStreamSource({head:source(head),comments:source(comments),granule:0n,size:length+head.length});
  expect(result).toEqual({codec:'opus',sampleRate:48000,channels:255,samples:0,duration:0,bitrate:0,tags:{title:'first;last',TITLE:'second;third',EMPTY:''}});
});
it('decodes multi-chunk UTF-8 comments in explicit collecting mode',async()=>{
  const f=fixture('vorbis'),value='é😀x'.repeat(12000),tags=encodeComments({title:value}),comments=new Uint8Array(7+tags.length+1);
  comments.set([3,...encoder.encode('vorbis')]);comments.set(tags,7);comments[comments.length-1]=1;
  let largest=0;const result=await api.probeOggStreamSource({head:source(f.head),comments:{size:comments.length,async read(offset,length){largest=Math.max(largest,length);return comments.subarray(offset,offset+length);}},granule:44100n,size:comments.length});
  expect(result.tags).toEqual({TITLE:value});expect(result.duration).toBe(1);expect(largest).toBeLessThanOrEqual(16384);
});
it('rejects missing packets, invalid sizes, short ranges and oversized responses',async()=>{
  const f=fixture('opus'),input={head:source(f.head),comments:source(f.comments),granule:f.granule,size:f.size};
  await expect(api.probeOggStreamSource({...input,comments:undefined})).rejects.toThrow('Missing OpusTags');
  for(const size of [-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])await expect(api.probeOggStreamSource({...input,size})).rejects.toThrow('Invalid Ogg stream size or granule');
  await expect(api.probeOggStreamSource({...input,granule:-1n})).rejects.toThrow('Invalid Ogg stream size or granule');
  await expect(api.probeOggStreamSource({...input,head:{size:19,async read(){return new Uint8Array();}}})).rejects.toThrow('Truncated or invalid audio structure');
  await expect(api.probeOggStreamSource({...input,head:{size:19,async read(){return new Uint8Array(20);}}})).rejects.toThrow('Truncated or invalid audio structure');
});
