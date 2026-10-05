import assert from "node:assert/strict";
import { it } from "node:test";
import * as media from "./index.js";

const scan = media.scanMp4Boxes;
function box(type: string, payload: Uint8Array = new Uint8Array(), declared = payload.length + 8) {
  const bytes = new Uint8Array(payload.length + 8); new DataView(bytes.buffer).setUint32(0, declared); bytes.set(media.encodeUtf8(type),4); bytes.set(payload,8); return bytes;
}
const source = (bytes: Uint8Array): media.MediaProbeSource => ({ size: bytes.length, async read(offset,length) { assert.ok(length <= 16); return bytes.subarray(offset,offset+Math.min(length,3)); } });
for (const [name, bytes] of [
  ['ordinary',media.concatBytes([box('free',new Uint8Array(31)),box('mdat',new Uint8Array(50000))])],
  ['zero',box('mdat',new Uint8Array(31),0)],
  ['oversize',box('mdat',new Uint8Array(31),999)],
  ['undersize',box('free',new Uint8Array(31),2)],
  ['uuid',box('uuid',Uint8Array.from({length:25},(_,i)=>i))],
  ['short uuid',box('uuid',new Uint8Array(8))],
  ['trailing bytes',media.concatBytes([box('free'),new Uint8Array(7)])],
  ['truncated extended',box('mdat',new Uint8Array(7),1)],
  ['containers',box('moov',box('trak',box('free')))],
  ['full meta',box('meta',media.concatBytes([new Uint8Array(4),box('hdlr')]))],
  ['quicktime meta',box('meta',box('abcd',new Uint8Array(4)))],
  ['short meta',box('meta',new Uint8Array(11))]
] as const) it(`scans ${name} without retaining box payloads`,async()=>{
  assert.equal(typeof scan,'function');const actual=[];
  for await(const span of scan(source(bytes))){const old=media.parseMp4Boxes(bytes).find(box=>box.offset===span.offset)!;assert.equal(span.payloadOffset,old.offset+old.headerSize);assert.equal(span.payloadSize,old.payload.length);assert.deepEqual(span.uuid,old.uuid);assert.equal(!!span.children,!!old.children);actual.push([span.type,span.offset,span.size,span.headerSize]);}
  assert.deepEqual(actual,media.parseMp4Boxes(bytes).map(box=>[box.type,box.offset,box.size,box.headerSize]));
  const expected: Record<string, [string, number, number, number][]> = {
    ordinary: [['free',0,39,8],['mdat',39,50008,8]], zero: [['mdat',0,39,8]], oversize: [['mdat',0,39,8]], undersize: [['free',0,39,8]],
    uuid: [['uuid',0,33,24]], 'short uuid': [['uuid',0,16,8]], 'trailing bytes': [['free',0,8,8]], 'truncated extended': [],
    containers: [['moov',0,24,8]], 'full meta': [['meta',0,20,8]], 'quicktime meta': [['meta',0,20,8]], 'short meta': [['meta',0,19,8]]
  };
  assert.deepEqual(actual,expected[name]);
});
it('skips a terabyte payload through caller range reads',async()=>{
  assert.equal(typeof scan,'function');const header=box('mdat',new Uint8Array(8),1);new DataView(header.buffer).setBigUint64(8,2n**40n);const reads:number[]=[];
  const spans=[];for await(const span of scan({size:2**40,async read(offset,length){reads.push(offset);assert.ok(offset+length<=16);return header.slice(offset,offset+length);}}))spans.push(span);
  assert.equal(spans.length,1);assert.equal(spans[0]!.payloadSize,2**40-16);assert.deepEqual(reads,[0,8]);
});
it('defers later reads until the consumer requests the next box',async()=>{
  assert.equal(typeof scan,'function');const bytes=media.concatBytes([box('free'),box('mdat')]);let reads=0;
  const iterator=scan({size:bytes.length,async read(offset,length){reads++;return bytes.slice(offset,offset+length);}})[Symbol.asyncIterator]();
  await iterator.next();assert.equal(reads,1);await iterator.return?.();assert.equal(reads,1);
});
it('rejects invalid sources, short reads, cancellation and checkpoint failure',async()=>{
  assert.equal(typeof scan,'function');const collect=async(input:media.MediaProbeSource,options={})=>{for await(const span of scan(input,options))void span;};
  await assert.rejects(collect({size:-1,async read(){throw new Error('unexpected');}}),/size/);
  await assert.rejects(collect({size:8,async read(){return new Uint8Array();}}),/Truncated/);
  await assert.rejects(collect({size:8,async read(){return new Uint8Array(9);}}),/more bytes/);
  const controller=new AbortController();await assert.rejects(collect({size:8,async read(){controller.abort(new Error('cancelled'));return box('free');}},{signal:controller.signal}),/cancelled/);
  await assert.rejects(collect(source(box('free')),{checkpoint(){throw new Error('checkpoint failed');}}),/checkpoint failed/);
});

it('exposes absolute nested ranges and owns extended UUID bytes',async()=>{
  const nested=box('uuid',new Uint8Array(27),1);new DataView(nested.buffer).setBigUint64(8,35n);nested.set(Array.from({length:16},(_,i)=>i),16);
  const bytes=box('moov',nested),input=source(bytes),parents=[];for await(const span of scan(input))parents.push(span);
  assert.deepEqual(parents[0]!.children,{offset:8,length:35,depth:1});
  const children=[];for await(const span of scan(input,parents[0]!.children))children.push(span);
  assert.equal(children[0]!.offset,8);assert.equal(children[0]!.size,35);assert.equal(children[0]!.headerSize,32);assert.equal(children[0]!.payloadOffset,40);assert.equal(children[0]!.payloadSize,3);
  bytes.fill(0);assert.deepEqual(children[0]!.uuid,Uint8Array.from({length:16},(_,i)=>i));
});
it('checks caller depth limits and invalid ranges before reading',async()=>{
  const input={size:16,async read(){throw new Error('unexpected read');}};
  const collect=async(options:media.Mp4BoxScanOptions)=>{for await(const span of scan(input,options))void span;};
  await assert.rejects(collect({depth:1,budget:new media.MediaBudgetTracker({maxBoxDepth:0})}),/maxBoxDepth/);
  for(const options of [{offset:-1},{offset:17},{length:17},{offset:1.5},{length:NaN},{depth:-1},{depth:1.5}])await assert.rejects(collect(options),RangeError);
});
it('rechecks cancellation when resumed after yielding a box',async()=>{
  const controller=new AbortController(),iterator=scan(source(box('free')),{signal:controller.signal});await iterator.next();controller.abort(new Error('cancelled between boxes'));await assert.rejects(iterator.next(),/cancelled between boxes/);
});
