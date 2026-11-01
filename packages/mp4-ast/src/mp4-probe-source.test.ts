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

for (const reader of ['resident', 'source']) {
  for (const fragmented of [false, true]) {
    it(`${reader} stream starts use the edit presentation timeline: fragmented=${fragmented}`, async () => {
      const base = api.parseMp4(api.createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 10, includeAudio: true }));
      for (const movieTimescale of [1000, 768000]) {
        for (const scenario of ['no edits', 'encoder lead-in', 'trim', 'delay', 'two delays']) {
          const tracks = base.tracks.map(track => {
            const offset = track.type === 'video' ? track.timescale / 5 : 0;
            const edit = (duration: number, mediaTime: number) => ({ segmentDuration: Math.round(duration * movieTimescale), mediaTime, mediaRateInteger: 1, mediaRateFraction: 0 });
            const mediaTime = scenario === 'trim' ? track.timescale / 2 : track.type === 'audio' ? 1024 : offset;
            const editList = scenario === 'no edits' ? undefined : [
              ...(scenario === 'delay' ? [edit(0.75, -1)] : scenario === 'two delays' ? [edit(0.25, -1), edit(0.5, -1)] : []),
              edit(1, mediaTime)
            ];
            return { ...track, editList, samples: track.samples.map(sample => ({ ...sample, pts: sample.pts + offset, cts: sample.cts + offset })) };
          });
          const bytes = api.serializeMp4({ ...base, timescale: movieTimescale, tracks }, { fragmented });
          const probe = reader === 'resident' ? api.probeMp4(bytes) : await api.probeMp4Source({
            size: bytes.length,
            async read(offset, length) { assert.ok(length <= 16384); return bytes.slice(offset, offset + Math.min(length, 31)); }
          }, { syncSamples });
          let index = 0;
          for await (const stream of probe.streams) {
            const track = tracks[index++]!;
            const start = scenario === 'no edits' ? track.samples[0]!.pts : scenario.includes('delay') ? Math.round(track.timescale * 0.75) : 0;
            assert.equal(stream.start_pts, start, `${scenario}: ${track.type}, movie scale ${movieTimescale}`);
            assert.equal(stream.start_time, (start / track.timescale).toFixed(6));
          }
          assert.equal(index, tracks.length);
        }
      }
    });
  }
}

for (const reader of ['resident', 'source']) {
  for (const fragmented of [false, true]) {
    it(`${reader} excludes leading edits from media duration and reports the file interval: fragmented=${fragmented}`, async () => {
      const base = api.parseMp4(api.createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 10, includeAudio: true }));
      for (const delays of [[1, 0.75], [1, 0], [1, 1]]) {
        const tracks = base.tracks.map((track, index) => ({ ...track, editList: [
          { segmentDuration: delays[index]! * base.timescale, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
          { segmentDuration: base.timescale, mediaTime: 0, mediaRateInteger: 1, mediaRateFraction: 0 }
        ] }));
        const bytes = api.serializeMp4({ ...base, tracks }, { fragmented });
        const probe = reader === 'resident' ? api.probeMp4(bytes) : await api.probeMp4Source({
          size: bytes.length,
          async read(offset, length) { assert.ok(length <= 16384); return bytes.slice(offset, offset + Math.min(length, 31)); }
        }, { syncSamples });
        let index = 0;
        for await (const stream of probe.streams) {
          assert.equal(stream.start_time, delays[index]!.toFixed(6));
          assert.equal(stream.duration, '1.000000', `${stream.codec_type}, delays ${delays}`);
          assert.equal(stream.duration_ts, tracks[index]!.timescale);
          index++;
        }
        assert.equal(index, 2);
        const start = Math.min(...delays), duration = Math.max(...delays) + 1 - start;
        assert.equal(probe.format.start_time, start.toFixed(6));
        assert.equal(probe.format.duration, duration.toFixed(6));
        assert.equal(probe.format.bit_rate, String(Math.round(bytes.length * 8 / duration)));
      }
      const video = base.tracks[0]!;
      const bytes = api.serializeMp4({ ...base, tracks: [{ ...video, samples: video.samples.map(sample => ({ ...sample, pts: sample.pts + 18000, cts: sample.cts + 18000 })) }] }, { fragmented });
      const probe = reader === 'resident' ? api.probeMp4(bytes) : await api.probeMp4Source({
        size: bytes.length, async read(offset, length) { return bytes.slice(offset, offset + length); }
      }, { syncSamples });
      assert.equal(probe.format.start_time, '0.200000');
      assert.equal(probe.format.duration, '1.000000');
    });
  }
}
