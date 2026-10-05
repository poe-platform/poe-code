import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from './index.js';
for(const fragmented of [false,true])test(`source frame descriptors match classic/fragmented media output: ${fragmented}`,async()=>{
  const bytes=api.createSyntheticMp4({frameCount:4,width:80,height:48,includeAudio:true,channels:1,fragmented});
  const expected=api.probeMp4(bytes,{showFrames:true}).frames,actual=[];
  assert.equal(typeof api.scanMp4Frames,'function');
  for await(const frame of api.scanMp4Frames({size:bytes.length,async read(offset,length){assert.ok(length<=16384);return bytes.slice(offset,offset+length);}},{syncSamples(){const keys=new Set<number>();return{add(n:number){keys.add(n);},has(n:number){return keys.has(n);}};}}))actual.push(frame);
  assert.deepEqual(actual,expected);
});

test('source frame descriptors preserve subtitles and PCM sample format',async()=>{
  const doc=api.parseMp4(api.createSyntheticMp4({frameCount:1,includeAudio:true}));
  const track=doc.tracks[0]!,subtitle={...track,id:3,type:'subtitle' as const,handlerType:'sbtl',timescale:1000,duration:400,codecDescriptions:[{formatFourCC:'tx3g',codecName:'mov_text'}],samples:[{data:new TextEncoder().encode('Hi'),dts:100,pts:100,cts:0,duration:300,size:2,isKeyframe:true,sampleDescriptionIndex:1}]};
  const audio={...doc.tracks[1]!,codecDescriptions:[{formatFourCC:'sowt',codecName:'pcm_s16le',sampleRate:44100,channels:1,bitsPerSample:16}]};
  for(const fragmented of [false,true]){
    const bytes=api.serializeMp4({...doc,tracks:[subtitle,audio]},{fragmented}),actual=[];
    for await(const frame of api.scanMp4Frames({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},{syncSamples(){const keys=new Set<number>();return{add(n:number){keys.add(n);},has(n:number){return keys.has(n);}};}}))actual.push(frame);
    assert.deepEqual(actual,api.probeMp4(bytes,{showFrames:true}).frames);assert.equal(actual.find(frame=>frame.media_type==='audio')?.sample_fmt,'s16');
  }
});
