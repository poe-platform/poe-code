import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as media from './index.js';

for(const fragmented of [false,true])it(`replays packet descriptors from caller ranges: fragmented=${fragmented}`,async()=>{
  assert.equal(typeof media.scanMp4Packets,'function');
  const bytes=media.createSyntheticMp4({frameCount:5,includeAudio:true,fragmented}),expected=media.probeMp4(bytes,{showPackets:true}).packets;
  const packets=[];
  for await(const packet of media.scanMp4Packets({size:bytes.length,async read(offset,length){assert.ok(length<=16384);return bytes.subarray(offset,offset+Math.min(length,7));}},{syncSamples(){const keys=new Set<number>();return {add(n:number){keys.add(n);},has(n:number){return keys.has(n);}};}}))packets.push(packet);
  assert.deepEqual(packets,expected);
});
it('enforces track, sample and duration budgets without reading payload',async()=>{
  const bytes=media.createSyntheticMp4({frameCount:5,includeAudio:false,fragmented:true});
  const source={size:bytes.length,async read(offset:number,length:number){return bytes.slice(offset,offset+length);}};
  for(const limits of [{maxStreams:0},{maxSamplesPerTrack:1},{maxDurationSeconds:0.01}])await assert.rejects((async()=>{for await(const packet of media.scanMp4Packets(source,{limits}))void packet;})(),/limit|exceeds|max/);
});
it('preserves subtitle repacking, empty gaps and packet positions',async()=>{
  const bytes=media.createSyntheticMp4({frameCount:1,includeAudio:false}),doc=media.parseMp4(bytes),track=doc.tracks[0]!;
  const subtitle={...track,id:2,type:'subtitle' as const,handlerType:'sbtl',timescale:1000,duration:900,codecDescriptions:[{formatFourCC:'tx3g',codecName:'mov_text'}],samples:[{data:new TextEncoder().encode('Hi'),dts:100,pts:100,cts:0,duration:300,size:2,isKeyframe:true,sampleDescriptionIndex:1},{data:new TextEncoder().encode('Bye'),dts:600,pts:600,cts:0,duration:300,size:3,isKeyframe:true,sampleDescriptionIndex:1}]};
  for(const fragmented of [false,true]){
    const input=media.serializeMp4({...doc,tracks:[subtitle]},{fragmented}),packets=[];
    for await(const packet of media.scanMp4Packets({size:input.length,async read(offset,length){return input.slice(offset,offset+length);}},{syncSamples(){const keys=new Set<number>();return {add(n:number){keys.add(n);},has(n:number){return keys.has(n);}};}}))packets.push(packet);
    assert.deepEqual(packets,media.probeMp4(input,{showPackets:true}).packets);
  }
});
it('checks edit-list duration, including open-ended fragment edits',async()=>{
  const doc=media.parseMp4(media.createSyntheticMp4({frameCount:1,includeAudio:false}));
  for(const fragmented of [false,true]){
    const track={...doc.tracks[0]!,editList:[{segmentDuration:fragmented?0:5000,mediaTime:0,mediaRateInteger:1,mediaRateFraction:0}]};
    const bytes=media.serializeMp4({...doc,tracks:[track]},{fragmented});
    await assert.rejects((async()=>{for await(const packet of media.scanMp4Packets({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},{limits:{maxDurationSeconds:fragmented?0.05:1},syncSamples(){const keys=new Set<number>();return {add(n:number){keys.add(n);},has(n:number){return keys.has(n);}};}}))void packet;})(),/maxDurationSeconds/);
  }
});
it('does not acquire input after cancellation and releases caches after index failure',async()=>{
  const controller=new AbortController();controller.abort(new Error('cancelled packets'));
  await assert.rejects(media.scanMp4Packets({size:100,async read(){throw new Error('unexpected read');}},{signal:controller.signal}).next(),/cancelled packets/);
  const bytes=media.createSyntheticMp4({frameCount:2,includeAudio:false}),budget=new media.MediaBudgetTracker();
  await assert.rejects(media.scanMp4Packets({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},{budget,syncSamples(){return {add(){throw new Error('index failed');},has(){return false;}};}}).next(),/index failed/);
  assert.equal(budget.getStats().currentMemoryBytes,0);
});
