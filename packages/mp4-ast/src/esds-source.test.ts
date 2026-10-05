import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from './index.js';
import { parseEsds } from './codecs.js';

const expected={objectTypeIndication:0x40,audioObjectType:2,sampleRate:44100,channelCount:2,maxBitrate:128000,avgBitrate:128000};
function metadata(bytes:Uint8Array){const {decoderSpecificInfo: ignoredInfo,rawEsdsBytes: ignoredRaw,...result}=parseEsds(bytes);return result;}
function probe(bytes:Uint8Array){return api.probeEsdsSource({size:bytes.length,async read(offset,length){assert.ok(length<=16384);return bytes.slice(offset,offset+length);}},{payloadOffset:0,payloadSize:bytes.length});}
test('source ESDS metadata matches independent AAC and MP3 descriptor values',async()=>{
  assert.equal(typeof api.probeEsdsSource,'function');
  assert.deepEqual(await probe(new Uint8Array([0,0,0,0,5,2,0x12,0x10])),expected);
  assert.deepEqual(await probe(new Uint8Array([0,0,0,0,5,6,249,94,1,119,0,192])),{...expected,audioObjectType:42,sampleRate:48000,channelCount:6});
  const mp3=new Uint8Array([0,0,0,0,4,13,0x6b,0x15,0,0,0,0,1,0xf4,0,0,0,0xfa,0,5,2,0x12,0x10]);
  assert.deepEqual(await probe(mp3),{...expected,objectTypeIndication:0x6b,maxBitrate:128000,avgBitrate:64000});
});
test('source and resident ESDS share truncated descriptor and flag semantics',async()=>{
  const bytes=new Uint8Array([0,0,0,0,3,25,0,1,0xe0,0,2,3,65,66,67,0,3,4,13,0x40,0x15,0,0,0,0,1,0xf4,0,0,0,0xfa,0,5,6,0xf9,0xf8,0,0xac,0x44,0x20]);
  for(let length=0;length<=bytes.length;length++){const input=bytes.subarray(0,length);assert.deepEqual(await probe(input),metadata(input),`prefix ${length}`);}
});
test('source ESDS skips huge unknown and decoder-specific payloads',async()=>{
  // Maximum four-byte descriptor length: 268435455 bytes. Only six ASC bytes are needed.
  const length=0x0fffffff,ascOffset=9+length+5,size=ascOffset+length;
  let reads=0;
  const values=new Map<number,number>();
  [0,0,0,0,6,0xff,0xff,0xff,0x7f].forEach((value,i)=>values.set(i,value));
  [5,0xff,0xff,0xff,0x7f,0x12,0x10].forEach((value,i)=>values.set(9+length+i,value));
  const result=await api.probeEsdsSource({size,async read(offset,count){reads++;assert.ok(count<=16384);return Uint8Array.from({length:count},(_,i)=>values.get(offset+i)??0);}},{payloadOffset:0,payloadSize:size});
  assert.deepEqual(result,expected);assert.ok(reads<5);
});
test('source ESDS releases its cache on cancellation, errors and memory rejection',async()=>{
  for(const mode of ['cancel','read','memory']){
    const controller=new AbortController(),budget=new api.MediaBudgetTracker({maxMemoryBytes:mode==='memory'?1:16384});
    await assert.rejects(api.probeEsdsSource({size:20000,async read(_offset,length){if(mode==='read')throw new Error('source failed');controller.abort(new Error('cancelled descriptor'));return new Uint8Array(length);}},{payloadOffset:0,payloadSize:20000},{signal:controller.signal,budget}),mode==='read'?/source failed/:mode==='cancel'?/cancelled descriptor/:/maxMemoryBytes/);
    assert.equal(budget.getStats().currentMemoryBytes,0);
  }
});

test('source ESDS handles nonzero ranges and borrowed short reads across a cache boundary',async()=>{
  const prefix=11,bytes=new Uint8Array(prefix+16400),at=prefix+16382;
  // Unknown descriptor skips to an ASC header crossing the 16 KiB page boundary.
  bytes.set([0,0,0,0,6,0xff,0x77],prefix);
  bytes.set([5,2,0x12,0x10],at);
  const borrowed=new Uint8Array(71);let reads=0;
  const actual=await api.probeEsdsSource({size:bytes.length,async read(offset,length){reads++;const take=Math.min(length,borrowed.length);borrowed.set(bytes.subarray(offset,offset+take));return borrowed.subarray(0,take);}},{payloadOffset:prefix,payloadSize:bytes.length-prefix});
  assert.deepEqual(actual,expected);assert.ok(reads>200);
});
test('source ESDS rejects invalid ranges without reading and preserves resident decoder bytes',async()=>{
  const source={size:10,async read(){throw new Error('unexpected read');}};
  for(const range of [{payloadOffset:-1,payloadSize:1},{payloadOffset:1,payloadSize:10},{payloadOffset:0,payloadSize:NaN}])await assert.rejects(api.probeEsdsSource(source,range),/Invalid ES descriptor range/);
  const input=new Uint8Array([0,0,0,0,5,7,0x12,0x10,1,2,3,4,5]);
  const result=parseEsds(input);assert.equal(result.rawEsdsBytes,input);assert.deepEqual(result.decoderSpecificInfo,input.subarray(6));assert.equal(result.decoderSpecificInfo.buffer,input.buffer);
});
