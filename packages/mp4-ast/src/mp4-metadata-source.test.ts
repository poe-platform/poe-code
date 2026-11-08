import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from './index.js';

const text = (s: string) => new TextEncoder().encode(s);
const item = (type: string, value: string) => api.makeBox(type, api.makeBox('data', api.concatBytes([new Uint8Array(8), text(value)])));
function fixture(items: Uint8Array[], quicktime = false) {
  const ilst = api.makeBox('ilst', api.concatBytes(items));
  return api.concatBytes([api.makeBox('ftyp', api.concatBytes([api.encodeFourCC('qt  '),new Uint8Array([0,0,0,7]),api.encodeFourCC('isom'),api.encodeFourCC('éabc'),new Uint8Array([1,2])])),api.makeBox('moov',api.makeBox('udta',quicktime ? api.makeBox('meta',ilst) : api.makeFullBox('meta',0,0,ilst)))]);
}
const source = (bytes: Uint8Array) => ({size:bytes.length,async read(offset:number,length:number){assert.ok(length<=16384);return bytes.slice(offset,offset+length);}});
async function tags(values: api.MediaProbeSourceTags) {
  const result: Record<string,string> = {};
  for(const [key,value] of Object.entries(values)) { if(typeof value==='string') result[key]=value; else {let s='';for await(const chunk of value.chunks())s+=chunk;result[key]=s;} }
  return result;
}
test('source metadata preserves brands, duplicate nonempty tags, BOM and both meta layouts',async()=>{
  assert.equal(typeof api.probeMp4MetadataSource,'function');
  for(const qt of [false,true]) {
    const bytes=fixture([item('©nam','first'),item('©ART','Artist'),item('©nam','é😀\0inside\0\0'),item('©nam','\ufeff\0'),item('©alb','Album'),item('©day','2026'),item('©cmt','comment'),item('©gen','genre'),item('©too','encoder'),item('aART','not a probe tag'),item('covr','not a text tag')],qt);
    const result=await api.probeMp4MetadataSource(source(bytes),0);
    assert.deepEqual(await tags(result.tags),api.probeMp4(bytes).format.tags);
    assert.deepEqual(await tags(result.tags),await tags(result.tags));
  }
});
test('source metadata clips fallback data and respects first meta and ftyp precedence',async()=>{
  for(const bytes of [api.makeBox('moov',new Uint8Array()),fixture([api.makeBox('©nam',text('fallback text')),api.makeBox('©ART',text('short')),api.makeBox('©too',api.makeBox('data',text('short')))]),api.concatBytes([api.makeBox('styp',api.concatBytes([api.encodeFourCC('abcd'),new Uint8Array(4)])),fixture([item('©nam','title')])])]) {
    assert.deepEqual(await tags((await api.probeMp4MetadataSource(source(bytes),0)).tags),api.probeMp4(bytes).format.tags);
  }
});
test('source chapters preserve extended counts, clipped titles and one-row lookahead',async()=>{
  for(const extended of [false,true]) {
    const writer=new api.BinaryWriter();writer.writeU32BE(0);writer.writeU32BE(0);writer.writeU8(extended?0:3);if(extended)writer.writeU32BE(3);
    for(const [start,title] of [[0,'First'],[1.25,'é😀'],[4,'End']] as const){writer.writeU64BE(start*10000000);const bytes=text(title);writer.writeU8(bytes.length);writer.writeBytes(bytes);}
    const bytes=api.makeBox('moov',api.makeBox('udta',api.makeBox('chpl',writer.toUint8Array())));
    const result=await api.probeMp4MetadataSource(source(bytes),0),chapters=[];
    for await(const chapter of result.chapters)chapters.push(chapter);
    assert.deepEqual(chapters,api.probeMp4(bytes).chapters);
    assert.equal(chapters[1]!.end_time,'4.000000');
  }
});
test('large text is replayed in bounded chunks with backpressure, short reads and cancellation',async()=>{
  const value='é😀'.repeat(20000)+'\0middle',bytes=fixture([item('©nam',value+'\0'.repeat(20000))]);
  let reads=0;const controller=new AbortController();
  const input={size:bytes.length,async read(offset:number,length:number){reads++;assert.ok(length<=16384);return bytes.slice(offset,offset+Math.min(length,997));}};
  const result=await api.probeMp4MetadataSource(input,0,{signal:controller.signal}),title=result.tags.title;
  assert.ok(title&&typeof title!=='string');const before=reads,iterator=(async function*(){yield* title.chunks();})();
  const first=await iterator.next();assert.ok(!first.done&&first.value.length<=16384);assert.ok(reads-before<20);await iterator.return(undefined);
  assert.equal((await tags(result.tags)).title,value);controller.abort(new Error('cancelled metadata'));await assert.rejects(tags(result.tags),/cancelled metadata/);
});
test('missing moov, source errors and truncation remain explicit',async()=>{
  await assert.rejects(api.probeMp4MetadataSource(source(api.makeBox('free',new Uint8Array())),0),/missing 'moov'/);
  const bytes=fixture([item('©nam','test')]);
  await assert.rejects(api.probeMp4MetadataSource({size:bytes.length,async read(){throw new Error('read failed');}},0),/read failed/);
  await assert.rejects(api.probeMp4MetadataSource({size:bytes.length,async read(){return new Uint8Array();}},0),/Truncated/);
});

test('source text releases its budget on early return, read error and cancellation',async()=>{
  const bytes=fixture([item('©nam','x'.repeat(40000))]);
  for(const mode of ['return','error','cancel']){
    const budget=new api.MediaBudgetTracker({maxMemoryBytes:16384}),controller=new AbortController();let fail=false;
    const input={size:bytes.length,async read(offset:number,length:number){if(fail){if(mode==='cancel')controller.abort(new Error('cancel text'));else throw new Error('text read failed');}return bytes.slice(offset,offset+length);}};
    const result=await api.probeMp4MetadataSource(input,0,{budget,signal:controller.signal}),title=result.tags.title;assert.ok(title&&typeof title!=='string');
    const iterator=(async function*(){yield* title.chunks();})();assert.equal((await iterator.next()).done,false);assert.equal(budget.getStats().currentMemoryBytes,16384);
    if(mode==='return')await iterator.return(undefined);else{fail=true;await assert.rejects(iterator.next(),mode==='cancel'?/cancel text/:/text read failed/);}
    assert.equal(budget.getStats().currentMemoryBytes,0);
  }
});
test('chapter parsing handles clipped tails without collecting or reading the next chapter early',async()=>{
  const writer=new api.BinaryWriter();writer.writeU32BE(0);writer.writeU32BE(0);writer.writeU8(255);
  for(let i=0;i<20;i++){writer.writeU64BE(i*10000000);writer.writeU8(4);writer.writeBytes(text('test'));}
  const payload=writer.toUint8Array();
  for(const cut of [0,1,5,9,13]){
    const bytes=api.makeBox('moov',api.makeBox('udta',api.makeBox('chpl',payload.subarray(0,payload.length-cut))));
    let reads=0;const input={size:bytes.length,async read(offset:number,length:number){reads++;return bytes.slice(offset,offset+length);}};
    const metadata=await api.probeMp4MetadataSource(input,0),before=reads,iterator=metadata.chapters[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done,false);assert.ok(reads-before<=5);const stopped=reads;await iterator.return?.();assert.equal(reads,stopped);
    const actual=[];for await(const chapter of metadata.chapters)actual.push(chapter);assert.deepEqual(actual,api.probeMp4(bytes).chapters);
  }
});
