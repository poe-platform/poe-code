import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as api from './index.js';
const syncSamples=()=>{const keys=new Set<number>();return{add(n:number){keys.add(n);},has(n:number){return keys.has(n);}};};
async function resident(value:unknown):Promise<unknown>{
  if(value&&typeof value==='object'&&'kind'in value&&value.kind==='text'&&'chunks'in value){let s='';for await(const chunk of (value as api.MediaProbeText).chunks())s+=chunk;return s;}
  if(value&&typeof value==='object'&&(Symbol.asyncIterator in value||Symbol.iterator in value)){const rows=[];for await(const row of value as AsyncIterable<unknown>)rows.push(await resident(row));return rows;}
  if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const [k,v]of Object.entries(value))out[k]=await resident(v);return out;}return value;
}
for(const fragmented of [false,true])it(`source full probe preserves all MP4 rows: fragmented=${fragmented}`,async()=>{
  assert.equal(typeof api.probeMp4Source,'function');
  const base=api.parseMp4(api.createSyntheticMp4({frameCount:5,includeAudio:true}));
  const doc={...base,metadata:{title:'é😀\0title',artist:'Artist'},chapters:[{id:0,startTimeSeconds:0,endTimeSeconds:1,title:'Chapter'}],tracks:base.tracks.map(t=>({...t,language:'pol',handlerName:'Handler é😀',rotation:90,enabled:false}))};
  const bytes=api.serializeMp4(doc,{fragmented}),options={filename:'input.mp4',showPackets:true,showFrames:true};
  const probe=await api.probeMp4Source({size:bytes.length,async read(offset,length){assert.ok(length<=16384);return bytes.slice(offset,offset+Math.min(length,31));}},{...options,syncSamples});
  assert.deepEqual(await resident(probe),api.probeMp4(bytes,options));
});
it('source streams retain zero-sample tracks and subtitle normalization aggregates',async()=>{
  const base=api.parseMp4(api.createSyntheticMp4({frameCount:1,includeAudio:false})),track=base.tracks[0]!;
  const subtitle={...track,id:2,type:'subtitle' as const,handlerType:'sbtl',timescale:1000,duration:900,codecDescriptions:[{formatFourCC:'tx3g',codecName:'mov_text'}],samples:[{data:new TextEncoder().encode('Hi'),dts:100,pts:100,cts:0,duration:300,size:2,isKeyframe:true,sampleDescriptionIndex:1},{data:new TextEncoder().encode('Bye'),dts:600,pts:600,cts:0,duration:300,size:3,isKeyframe:true,sampleDescriptionIndex:1}]};
  for(const fragmented of [false,true]){
    const bytes=api.serializeMp4({...base,tracks:[{...track,samples:[]},subtitle]},{fragmented}),options={showPackets:true,showFrames:true};
    const probe=await api.probeMp4Source({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},{...options,syncSamples});
    assert.deepEqual(await resident(probe),api.probeMp4(bytes,options));
  }
});
it('source full probe enforces duration and track limits and releases working pages',async()=>{
  const bytes=api.createSyntheticMp4({frameCount:5,includeAudio:true}),source={size:bytes.length,async read(offset:number,length:number){return bytes.slice(offset,offset+length);}};
  for(const limits of [{maxStreams:0},{maxSamplesPerTrack:1},{maxDurationSeconds:0.01}]){
    const budget=new api.MediaBudgetTracker(limits);await assert.rejects(api.probeMp4Source(source,{budget,syncSamples}),/limit|exceeds|max/);assert.equal(budget.getStats().currentMemoryBytes,0);
  }
});
it('source aggregates preserve composition offsets, edit duration and handler termination',async()=>{
  const base=api.parseMp4(api.createSyntheticMp4({frameCount:3,includeAudio:false})),track=base.tracks[0]!;
  for(const handlerName of ['', '\ufeff', 'first\0ignored', 'é😀'.repeat(12000)]){
    const changed={...track,handlerName,language:'fra',editList:[{segmentDuration:5000,mediaTime:0,mediaRateInteger:1,mediaRateFraction:0}],samples:track.samples.map((s,i)=>({...s,cts:i===1?500:-100,pts:s.dts+(i===1?500:-100)}))};
    const bytes=api.serializeMp4({...base,tracks:[changed]}),source={size:bytes.length,async read(offset:number,length:number){assert.ok(length<=16384);return bytes.slice(offset,offset+length);}};
    assert.deepEqual(await resident(await api.probeMp4Source(source,{syncSamples})),api.probeMp4(bytes));
  }
});
