import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from './index.js';

for (const faststart of [false, true]) for (const disableChpl of [false, true]) {
  it(`retains accessible chapter tracks with disableChpl=${disableChpl}, faststart=${faststart}`, () => {
    const chapters = [
      { id: 0, startTimeSeconds: 0, endTimeSeconds: 1, title: 'A' },
      { id: 1, startTimeSeconds: 1, endTimeSeconds: 3, title: 'B é😀' }
    ];
    const doc = { ...parseMp4(createSyntheticMp4({ frameCount: 3, fps: 1, includeAudio: false })), chapters };
    const bytes = serializeMp4(doc, { disableChpl, faststart });
    const moov = parseMp4Boxes(bytes).find(box => box.type === 'moov')!;
    const tracks = moov.children!.filter(box => box.type === 'trak');
    assert.equal(tracks.length, 2);
    assert.ok(tracks[0]!.children!.find(box => box.type === 'tref')?.children?.some(box => box.type === 'chap'));
    assert.equal(moov.children!.find(box => box.type === 'udta')?.children?.some(box => box.type === 'chpl') ?? false, !disableChpl);
    const chapterTrack = parseMp4(bytes, { decodeSubtitles: false }).tracks.at(-1)!;
    assert.deepEqual(chapterTrack.samples.map(sample => new TextDecoder().decode(sample.data.subarray(2))), chapters.map(chapter => chapter.title));
    assert.deepEqual(chapterTrack.samples.map(sample => [sample.pts, sample.duration]), [[0, 1000], [1000, 2000]]);
  });
}
