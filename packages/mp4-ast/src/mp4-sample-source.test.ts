import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as media from './index.js';

const scan = media.scanMp4SampleTable;
function fixture(frames=12){const bytes=media.createSyntheticMp4({frameCount:frames,includeAudio:true}),doc=media.parseMp4(bytes);const moov=media.parseMp4Boxes(bytes).find(b=>b.type==='moov')!;return {bytes,doc,tracks:moov.children!.filter(b=>b.type==='trak')};}
function tables(track:media.Mp4Box){const mdia=track.children!.find(b=>b.type==='mdia')!,minf=mdia.children!.find(b=>b.type==='minf')!,stbl=minf.children!.find(b=>b.type==='stbl')!;return Object.fromEntries(stbl.children!.map(b=>[b.type,{payloadOffset:b.offset+b.headerSize,payloadSize:b.payload.length}]));}
it('replays source sample tables without collecting timing/chunk/size arrays',async()=>{
  assert.equal(typeof scan,'function');const {bytes,doc,tracks}=fixture(20);
  for(const [index,track] of tracks.entries()){
    const keys=new Set<number>(),actual=[];
    for await(const sample of scan({size:bytes.length,async read(offset,length){assert.ok(length<=16384);return bytes.subarray(offset,offset+Math.min(length,37));}},tables(track),{type:doc.tracks[index]!.type,syncSamples:{add(value:number){keys.add(value);},has(value:number){return keys.has(value);}}})){
      const expected:media.MediaSample=doc.tracks[index]!.samples[actual.length]!;assert.deepEqual(bytes.subarray(sample.offset,sample.offset+sample.size),expected.data);actual.push({...sample,offset:undefined});
    }
    assert.deepEqual(actual,doc.tracks[index]!.samples.map(({data:_data,...sample})=>({...sample,offset:undefined})));
  }
});
it('propagates index and source failures before publishing a sample',async()=>{
  assert.equal(typeof scan,'function');const {bytes,tracks}=fixture();const input={size:bytes.length,async read(offset:number,length:number){return bytes.slice(offset,offset+length);}};
  const collect=async(options:Record<string,unknown>,source=input)=>{for await(const sample of scan(source,tables(tracks[0]!),options))void sample;};
  await assert.rejects(collect({syncSamples:{add(){throw new Error('index failed');},has(){return false;}}}),/index failed/);
  await assert.rejects(collect({}, {...input,async read(){throw new Error('source failed');}}),/source failed/);
});
it('checks cancellation and caller sample limits',async()=>{
  assert.equal(typeof scan,'function');const {bytes,tracks}=fixture(),controller=new AbortController();
  const collect=async(options:Record<string,unknown>)=>{for await(const sample of scan({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},tables(tracks[0]!),options))void sample;};
  controller.abort(new Error('cancelled'));
  await assert.rejects(collect({signal:controller.signal}),/cancelled/);
  await assert.rejects(collect({budget:new media.MediaBudgetTracker({maxSamplesPerTrack:1})}),/maxSamples/);
});

function rawTables(spec:Record<string,number[]>,size=600,versions:Record<string,number>={}){
  const bytes=new Uint8Array(size),tables:media.Mp4SampleTables={};let offset=0;
  for(const [name,words]of Object.entries(spec)){const length=4+words.length*4,view=new DataView(bytes.buffer,offset,length);view.setUint8(0,versions[name]??0);words.forEach((word,i)=>view.setUint32(4+i*4,word>>>0));tables[name as keyof media.Mp4SampleTables]={payloadOffset:offset,payloadSize:length};offset+=length;}
  return {bytes,tables};
}
it('preserves independent timing, unsorted mapping, clipping and keyframe vectors',async()=>{
  const {bytes,tables}=rawTables({stts:[2,2,10,1,20],ctts:[3,1,-2,0,3,1,-4],stsc:[3,3,2,0,1,1,2,4,2,3],stsz:[0,6,4,0,3,2,1000,1],stco:[4,512,520,530,540],stss:[4,6,1,6,0]},600,{ctts:1});
  const keys=new Set<number>(),actual=[],borrowed=new Uint8Array(7);
  for await(const sample of scan({size:bytes.length,async read(offset,length){const take=Math.min(length,7);borrowed.set(bytes.subarray(offset,offset+take));return borrowed.subarray(0,take);}},tables,{syncSamples:{add(n){keys.add(n);},has(n){return keys.has(n);}}}))actual.push(sample);
  assert.deepEqual(actual,[
    {offset:512,size:4,dts:0,pts:-2,cts:-2,duration:10,isKeyframe:true,sampleDescriptionIndex:1},
    {offset:516,size:0,dts:10,pts:6,cts:-4,duration:10,isKeyframe:false,sampleDescriptionIndex:1},
    {offset:520,size:3,dts:20,pts:16,cts:-4,duration:20,isKeyframe:false,sampleDescriptionIndex:1},
    {offset:523,size:2,dts:40,pts:36,cts:-4,duration:20,isKeyframe:false,sampleDescriptionIndex:1},
    {offset:530,size:70,dts:60,pts:56,cts:-4,duration:20,isKeyframe:false,sampleDescriptionIndex:2},
    {offset:540,size:1,dts:80,pts:76,cts:-4,duration:20,isKeyframe:true,sampleDescriptionIndex:3}
  ]);
});
it('preserves empty subtitle gaps and strips only valid text prefixes',async()=>{
  const {bytes,tables}=rawTables({stsz:[4,3],stsc:[1,1,3,1],stco:[1,128]},160);
  bytes.set([0,0,99,99,0,2,65,66,0,9,67,68],128);const actual=[];
  for await(const sample of scan({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},tables,{type:'subtitle'}))actual.push([sample.offset,sample.size,sample.dts,sample.duration]);
  assert.deepEqual(actual,[[134,2,1024,1024],[136,4,2048,1024]]);
});
it('uses zero values for truncated rows and the first keyframe for an empty stss',async()=>{
  const {bytes,tables}=rawTables({stsz:[1,3],stsc:[1,1,3,9],stco:[1,123],stss:[0]},128);
  tables.stsc={...tables.stsc!,payloadSize:18};tables.stco={...tables.stco!,payloadSize:10};tables.stss={...tables.stss!,payloadSize:7};const actual=[];
  for await(const sample of scan({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},tables))actual.push([sample.offset,sample.duration,sample.isKeyframe,sample.sampleDescriptionIndex]);
  assert.deepEqual(actual,[[0,1024,true,1],[1,1024,false,1],[2,1024,false,1]]);
});
it('requires caller membership only when keyframe entries exist and checks ranges',async()=>{
  const {bytes,tables}=rawTables({stss:[1,1]});const input={size:bytes.length,async read(offset:number,length:number){return bytes.slice(offset,offset+length);}};
  const collect=async(t:media.Mp4SampleTables)=>{for await(const sample of scan(input,t))void sample;};
  await assert.rejects(collect(tables),/index is required/);
  await assert.rejects(collect({stsz:{payloadOffset:1,payloadSize:bytes.length}}),/range/);
});
it('accounts and releases table-cache memory under the caller budget',async()=>{
  const {bytes,tables}=rawTables({stsz:[0,0]});const budget=new media.MediaBudgetTracker({maxMemoryBytes:11});
  await assert.rejects((async()=>{for await(const sample of scan({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},tables,{budget}))void sample;})(),/maxMemoryBytes/);
  assert.equal(budget.getStats().currentMemoryBytes,0);
});
