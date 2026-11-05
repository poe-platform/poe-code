import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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

// Generated with libx264: testsrc2=size=64x48:rate=10:duration=2,
// -g 20 -bf 3 -x264-params b-adapt=0:scenecut=0.
// Native ffprobe -show_frames reports all 20 PTS in ascending 1024-tick steps.
for (const fragmented of [false, true]) test(`B-frame presentation order, fragmented=${fragmented}`, async () => {
  const fixture = readFileSync(new URL('./fixtures/h264-b-frames.mp4', import.meta.url));
  const bytes = fragmented ? api.serializeMp4(api.parseMp4(fixture), { fragmented }) : fixture;
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
  const options = { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } };
  const packets: api.MediaProbePacket[] = [];
  for await (const packet of api.scanMp4Packets(source, options)) packets.push(packet);
  assert.deepEqual(packets.slice(0, 5).map(packet => packet.pts), [0, 4096, 2048, 1024, 3072]);
  const frames: api.MediaProbeFrame[] = [];
  for await (const frame of api.scanMp4Frames(source, options)) frames.push(frame);
  assert.deepEqual(frames.map(frame => frame.pts), Array.from({ length: 20 }, (_, i) => i * 1024));
  assert.deepEqual(frames.map(frame => frame.pkt_dts), [...packets.slice(2).map(packet => packet.dts), undefined, undefined]);
  assert.deepEqual(frames.map(frame => frame.pkt_dts_time), [...packets.slice(2).map(packet => packet.dts_time), undefined, undefined]);
  for (const frame of frames) {
    const packet = packets.find(packet => packet.pts === frame.pts)!;
    assert.equal(frame.pkt_size, packet.size);
    assert.equal(frame.key_frame, packet.flags.startsWith('K') ? 1 : 0);
    assert.equal(frame.best_effort_timestamp, frame.pts);
  }
});

for (const times of [[0, 6000, -3000, 0], [9000, 6000, 3000, 0]]) test(`orders signed and duplicate PTS: ${times}`, async () => {
  const doc = api.parseMp4(api.createSyntheticMp4({ frameCount: 4, includeAudio: false }));
  const track = doc.tracks[0]!;
  const bytes = api.serializeMp4({ ...doc, tracks: [{ ...track, editList: [],
    samples: track.samples.map((sample, i) => ({ ...sample, pts: times[i]!, cts: times[i]! - sample.dts }))
  }] });
  const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
  const options = { syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } };
  const packets: api.MediaProbePacket[] = [];
  for await (const packet of api.scanMp4Packets(source, options)) packets.push(packet);
  const frames: api.MediaProbeFrame[] = [];
  for await (const frame of api.scanMp4Frames(source, options)) frames.push(frame);
  assert.deepEqual(frames.map(frame => [frame.pts, frame.pkt_dts]),
    packets.sort((a, b) => a.pts! - b.pts!).map(packet => [packet.pts, packet.dts]));
});

test('releases buffered frame descriptors when the consumer stops early', async () => {
  const bytes = readFileSync(new URL('./fixtures/h264-b-frames.mp4', import.meta.url));
  const budget = new api.MediaBudgetTracker({ maxMemoryBytes: 65536 });
  const frames = api.scanMp4Frames({ size: bytes.length,
    async read(offset, length) { return bytes.subarray(offset, offset + length); }
  }, { budget, syncSamples() { const keys = new Set<number>(); return { add(n: number) { keys.add(n); }, has(n: number) { return keys.has(n); } }; } });
  assert.equal((await frames.next()).value!.pts, 0);
  await frames.return();
  assert.doesNotThrow(() => budget.allocateMemory(65536));
  budget.releaseMemory(65536);
});
