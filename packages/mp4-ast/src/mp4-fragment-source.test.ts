import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as media from './index.js';

function box(name: string, words: number[]): Uint8Array {
  const bytes = new Uint8Array(8 + words.length * 4), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = name.charCodeAt(i);
  words.forEach((word, i) => view.setUint32(8 + i * 4, word >>> 0));
  return bytes;
}
function fixture(...boxes: Uint8Array[]) {
  const length = boxes.reduce((n, b) => n + b.length, 0), bytes = new Uint8Array(length + 100);
  let offset = 0; for (const b of boxes) { bytes.set(b, offset); offset += b.length; }
  return { bytes, range: { offset: 0, length, depth: 2 }, source: { size: bytes.length, async read(at: number, size: number) { assert.ok(size <= 16384); return bytes.subarray(at, at + Math.min(size, 3)); } } };
}
const defaults = { defaultSampleDescriptionIndex: 1, defaultSampleDuration: 10, defaultSampleSize: 4, defaultSampleFlags: 0 };
it('streams independent fragmented sample vectors and returns carried timing/count', async () => {
  assert.equal(typeof media.scanMp4Fragment, 'function');
  const { source, range } = fixture(
    box('trun', [0x01000f05, 2, 200, 0x02000000, 7, 3, 0x01010000, -2, 11, 5, 0x02000000, 4]),
    box('tfhd', [0x000002, 9, 3]), box('tfdt', [0, 100]),
    box('trun', [0, 2])
  );
  const iterator = media.scanMp4Fragment(source, range, { trackId: 9, moofOffset: 0, defaults, type: 'video', state: { dts: 25, sampleCount: 6 } });
  const samples = [];
  let next = await iterator.next(); while (!next.done) { samples.push(next.value); next = await iterator.next(); }
  assert.deepEqual(samples.map(s => [s.offset,s.size,s.dts,s.pts,s.duration,s.isKeyframe,s.sampleDescriptionIndex]), [
    [200,3,100,98,7,false,3], [203,5,107,111,11,true,3], [0,4,118,118,10,true,3], [4,4,128,128,10,false,3]
  ]);
  assert.deepEqual(next.value, { dts: 138, sampleCount: 10 });
});
it('carries empty fragment timestamps and ignores other tracks', async () => {
  const { source, range } = fixture(box('tfhd',[0,9]),box('tfdt',[0x01000000,1,20]),box('trun',[0,0]));
  const options = { trackId: 9, moofOffset: 0, defaults, state: { dts: 5, sampleCount: 2 } };
  assert.deepEqual(await media.scanMp4Fragment(source,range,options).next(), { done:true,value:{ dts:4294967316,sampleCount:2 } });
  assert.deepEqual(await media.scanMp4Fragment(source,range,{...options,trackId:10}).next(), { done:true,value:options.state });
});
it('honors cancellation, source errors, sample budgets and early return', async () => {
  const { source, range } = fixture(box('tfhd',[0,9]),box('trun',[0,10000]));
  const options = { trackId:9,moofOffset:0,defaults };
  const budget = new media.MediaBudgetTracker({ maxSamplesPerTrack:9999 });
  await assert.rejects(media.scanMp4Fragment(source,range,{...options,budget}).next(), /maxSamples/);
  assert.equal(budget.getStats().currentMemoryBytes,0);
  const controller = new AbortController(), iterator = media.scanMp4Fragment(source,range,{...options,signal:controller.signal});
  assert.equal((await iterator.next()).done,false); controller.abort(new Error('cancelled'));
  await assert.rejects(iterator.next(),/cancelled/);
  await assert.rejects(media.scanMp4Fragment({...source,async read(){throw new Error('read failed');}},range,options).next(),/read failed/);
  const memory = new media.MediaBudgetTracker(), early = media.scanMp4Fragment(source,range,{...options,budget:memory});
  await early.next(); await early.return({dts:0,sampleCount:0}); assert.equal(memory.getStats().currentMemoryBytes,0);
});
it('matches resident fragmented tracks and handles clipping and truncated rows', async () => {
  const bytes = media.createSyntheticMp4({ frameCount:4,includeAudio:true,fragmented:true });
  const document = media.parseMp4(bytes), boxes = media.parseMp4Boxes(bytes), moof = boxes.find(b => b.type === 'moof')!;
  for (const [index, traf] of moof.children!.filter(b => b.type === 'traf').entries()) {
    const track = document.tracks[index]!, samples = [];
    for await (const sample of media.scanMp4Fragment({ size:bytes.length,async read(offset,length){return bytes.subarray(offset,offset+length);} }, {offset:traf.offset+traf.headerSize,length:traf.payload.length}, {trackId:track.id,moofOffset:moof.offset,defaults,type:track.type})) samples.push(sample);
    assert.deepEqual(samples.map(({offset,...sample})=>({...sample,data:bytes.subarray(offset,offset+sample.size)})),track.samples);
  }
  const f = fixture(box('tfhd',[0x39,9,0,999999,3,7,0]),box('trun',[0x800,3,0xffffffff]));
  const result = [];
  for await(const sample of media.scanMp4Fragment(f.source,f.range,{trackId:9,moofOffset:0,defaults})) result.push(sample);
  assert.deepEqual(result.map(s=>[s.offset,s.size,s.dts,s.cts]),[[f.bytes.length,0,0,4294967295],[f.bytes.length,0,3,0],[f.bytes.length,0,6,0]]);
});
it('releases table cache after allocation refusal and checks invalid source ranges', async () => {
  const {source,range} = fixture(box('tfhd',[0,9]),box('trun',[0,1]));
  const budget = new media.MediaBudgetTracker({maxMemoryBytes:7}),options = {trackId:9,moofOffset:0,defaults,budget};
  await assert.rejects(media.scanMp4Fragment(source,range,options).next(),/maxMemoryBytes/);
  assert.equal(budget.getStats().currentMemoryBytes,0);
  await assert.rejects(media.scanMp4Fragment(source,{offset:-1},options).next(),/range/);
  await assert.rejects(media.scanMp4Fragment({...source,size:Infinity},range,options).next(),/source size/);
  await assert.rejects(media.scanMp4Fragment({...source,async read(){return new Uint8Array();}},range,options).next(),/Truncated/);
  await assert.rejects(media.scanMp4Fragment({...source,async read(_offset,length){return new Uint8Array(length+1);}},range,options).next(),/more bytes/);
});
