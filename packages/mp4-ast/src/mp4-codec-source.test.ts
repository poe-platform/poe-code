import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from './index.js';

const scalar=(description:api.MediaCodecDescription)=>{
  const {avcC:ignoredAvc,hvcC:ignoredHvc,av1C:ignoredAv1,vpcC:ignoredVpc,esds:ignoredEsds,dOps:ignoredOpus,rawStsdEntryBytes:ignoredRaw,...result}=description;
  return result;
};
function entry(format:string,children:Uint8Array[]=[],version=0){
  const video=['avc1','hvc1','av01','vp09','mp4v'].includes(format),body=new Uint8Array(video?78:28+(version===1?16:version===2?36:0)),view=new DataView(body.buffer);
  if(video){view.setUint16(24,640);view.setUint16(26,360);}else{view.setUint16(8,version);view.setUint16(16,6);view.setUint16(18,24);view.setUint32(24,48000*65536);}
  return api.makeBox(format,api.concatBytes([body,...children]));
}
async function scan(entries:Uint8Array[]){
  const count=new Uint8Array(4);new DataView(count.buffer).setUint32(0,entries.length);
  const stsd=api.makeFullBox('stsd',0,0,api.concatBytes([count,...entries]));
  const bytes=api.makeBox('moov',api.makeBox('trak',api.makeBox('mdia',api.makeBox('minf',api.makeBox('stbl',stsd)))));
  const expected=api.parseMp4(bytes).tracks[0]!.codecDescriptions.map(scalar),actual=[];
  for await(const desc of api.scanMp4CodecDescriptions({size:bytes.length,async read(offset,length){assert.ok(length<=16384);return bytes.slice(offset,offset+length);}},{payloadOffset:48,payloadSize:stsd.length-8}))actual.push(desc);
  assert.deepEqual(actual,expected);return actual;
}
test('reads scalar codec descriptions with existing format, version and child-order semantics',async()=>{
  assert.equal(typeof api.scanMp4CodecDescriptions,'function');
  const rows=await scan([
    entry('avc1'),entry('hvc1',[api.makeBox('hvcC',new Uint8Array([1,2,0,0,0,0,0,0,0,0,0,0,120,0,0,0,1,2]))]),
    entry('av01',[api.makeBox('av1C',new Uint8Array([0x81,0x20,0x40]))]),entry('vp09',[api.makeBox('vpcC',new Uint8Array(12))]),
    entry('mp4a',[api.makeBox('esds',new Uint8Array([0,0,0,0,5,2,0x12,0x10]))]),
    entry('Opus',[api.makeBox('dOps',new Uint8Array([0,1,0,0,0,0,0,0,0,0,0]))],1),entry('sowt',[],2),entry('tx3g'),entry('stpp'),entry('xxxx')
  ]);
  assert.equal(rows[0]!.width,640);assert.equal(rows[1]!.pixFmt,'yuv420p10le');assert.equal(rows[4]!.sampleRate,44100);assert.equal(rows[5]!.channels,1);
});
test('preserves the first SPS dimensions without retaining extra parameter sets',async()=>{
  const config=api.buildH264SpsPps(80,48,25);
  const rows=await scan([entry('avc1',[api.makeBox('avcC',api.buildAvcC([config.sps],[config.pps]))])]);
  assert.equal(rows[0]!.width,80);assert.equal(rows[0]!.height,48);
});
test('handles truncated sample-entry bodies and malformed entry sizes',async()=>{
  for(const format of ['avc1','mp4a','Opus','tx3g'])for(const size of [0,7,27,28,77,78])await scan([api.makeBox(format,new Uint8Array(size))]);
  await scan([new Uint8Array([0,0,0,7,97,118,99,49])]);
});
test('bounds the first SPS, skips later parameter sets, and retires budget on failure',async()=>{
  const config=api.buildH264SpsPps(80,48,25),sps=new Uint8Array(65535);sps.set(config.sps);
  const raw=entry('avc1',[api.makeBox('avcC',api.buildAvcC([sps,sps],[config.pps]))]);
  const bytes=api.concatBytes([new Uint8Array([0,0,0,0,0,0,0,1]),raw]);
  for(const mode of ['ok','read','cancel','memory']){
    const controller=new AbortController(),budget=new api.MediaBudgetTracker({maxMemoryBytes:mode==='memory'?65534:65535});let reads=0,largest=0,total=0;
    const source={size:bytes.length,async read(offset:number,length:number){reads++;largest=Math.max(largest,length);total+=length;if(length===16384&&mode==='read')throw new Error('SPS read failed');if(length===16384&&mode==='cancel')controller.abort(new Error('cancelled SPS'));return bytes.slice(offset,offset+length);}};
    const run=async()=>{const rows=[];for await(const row of api.scanMp4CodecDescriptions(source,{payloadOffset:0,payloadSize:bytes.length},{budget,signal:controller.signal}))rows.push(row);return rows;};
    if(mode==='ok'){const rows=await run();assert.equal(rows[0]!.width,80);assert.ok(total<66000);assert.ok(reads<12);}
    else await assert.rejects(run(),mode==='read'?/SPS read failed/:mode==='cancel'?/cancelled SPS/:/maxMemoryBytes/);
    assert.ok(largest<=16384);assert.equal(budget.getStats().currentMemoryBytes,0);
  }
});
test('codec iteration stops before acquiring the next entry',async()=>{
  const bytes=api.concatBytes([new Uint8Array([0,0,0,0,0,0,0,2]),entry('mp4a'),entry('mp4a')]);let reads=0;
  const iterator=api.scanMp4CodecDescriptions({size:bytes.length,async read(offset,length){reads++;return bytes.slice(offset,offset+length);}},{payloadOffset:0,payloadSize:bytes.length});
  assert.equal((await iterator.next()).done,false);const before=reads;await iterator.return();assert.equal(reads,before);
});
