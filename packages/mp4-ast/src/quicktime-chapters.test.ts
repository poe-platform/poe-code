import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4, probeMp4Source } from './index.js';

// Native FFmpeg AAC + ffmetadata fixtures; track.mp4 uses +disable_chpl.
for (const name of ['track', 'many', 'long']) {
  for (const reader of ['resident', 'source']) it(`${reader} reads referenced QuickTime chapters: ${name}`, async () => {
    const bytes = readFileSync(new URL(`./fixtures/chapters/${name}.mp4`, import.meta.url));
    const result = reader === 'resident' ? probeMp4(bytes) : await probeMp4Source({
      size: bytes.length,
      async read(offset, length) { assert.ok(length <= 16384); return bytes.subarray(offset, offset + Math.min(length, 31)); }
    });
    const chapters = [];
    for await (const chapter of result.chapters ?? []) chapters.push(chapter);
    const expected = name === 'track' ? [[0, 1, 'A'], [1, 3, 'B']] : name === 'long'
      ? [[0, 3, 'q'.repeat(270) + 'HELLO']]
      : Array.from({ length: 260 }, (_, i) => [i / 100, (i + 1) / 100, String(i)]);
    assert.deepEqual(chapters.map(ch => [Number(ch.start_time), Number(ch.end_time), ch.tags?.title]), expected);
  });
}

it('falls back to Nero chapters when the reference is missing or unresolved', async () => {
  for (const kind of ['missing', 'unresolved']) {
    const bytes = readFileSync(new URL('./fixtures/chapters/long.mp4', import.meta.url));
    const marker = bytes.indexOf(Buffer.from('chap'));
    assert.ok(marker > 0);
    if (kind === 'missing') bytes.write('xxxx', marker);
    else bytes.writeUInt32BE(9999, marker + 4);
    const resident = probeMp4(bytes);
    const source = await probeMp4Source({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } });
    for (const result of [resident, source]) {
      const chapters = [];
      for await (const chapter of result.chapters ?? []) chapters.push(chapter);
      assert.equal(chapters.length, 1);
      assert.equal(chapters[0]!.tags?.title, 'q'.repeat(255));
    }
  }
});
