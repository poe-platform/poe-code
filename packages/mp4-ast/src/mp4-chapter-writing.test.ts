import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createSyntheticMp4, parseMp4, serializeMp4 } from './mp4.js';

const base = parseMp4(createSyntheticMp4({ frameCount: 3, fps: 1, width: 16, height: 16 }));
for (const options of [{ faststart: true }, { faststart: false }, { fragmented: true }]) {
  it(`writes all chapter titles and references ${JSON.stringify(options)}`, () => {
    const chapters = Array.from({ length: 260 }, (_, id) => ({
      id, startTimeSeconds: id / 100, endTimeSeconds: (id + 1) / 100,
      title: id === 259 ? 'é'.repeat(270) + 'HELLO' : `c${id}`
    }));
    const result = parseMp4(serializeMp4({ ...base, chapters }, options));
    const chapterTrack = result.tracks.find(track => track.codecDescriptions[0]?.formatFourCC === 'text');
    assert.ok(chapterTrack);
    assert.equal(chapterTrack.samples.length, 260);
    const last = chapterTrack.samples[259]!.data;
    const title = options.fragmented ? last.subarray(2) : last;
    assert.equal(new TextDecoder().decode(title), chapters[259]!.title);
    const moov = result.boxes!.find(box => box.type === 'moov')!;
    const traks = moov.children!.filter(box => box.type === 'trak');
    const reference = traks[0]!.children!.find(box => box.type === 'tref')!.children!.find(box => box.type === 'chap')!;
    assert.equal(new DataView(reference.payload.buffer, reference.payload.byteOffset).getUint32(0), chapterTrack.id);
    const nero = moov.children!.find(box => box.type === 'udta')!.children!.find(box => box.type === 'chpl')!;
    assert.equal(nero.payload[8], 255);
  });
}
it('uses successive chapter starts and the last end on a zero-based text timeline', () => {
  const chapters = [[0.2, 0.8], [1.2, 1.7], [2.2, 2.6]].map(([start, end], id) => ({
    id, startTimeSeconds: start!, endTimeSeconds: end!, title: String(id)
  }));
  const result = parseMp4(serializeMp4({ ...base, chapters }));
  const track = result.tracks.find(track => track.codecDescriptions[0]?.formatFourCC === 'text')!;
  assert.ok(track);
  assert.deepEqual(track.samples.map(sample => [sample.dts / track.timescale, (sample.dts + sample.duration) / track.timescale]), [[0, 1.2], [1.2, 2.2], [2.2, 2.6]]);
});
