import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { formatFfprobeResult, formatFfprobeSourceChunks } from './media.js';

const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url));
const probe = probeMp4(bytes, { showPackets: true, showFrames: true });
const opts = { printFormat: 'json', showFormat: false, showStreams: true, showPackets: true, showFrames: true, showChapters: false, showPrograms: false };
async function* rows<T>(values: Iterable<T>) { yield* values; }

for (const selector of ['v', 'v:0', 'a', 'a:0', '0', '1', 'a:1', '99']) {
  for (const printFormat of ['json', 'json:compact=1', 'default', 'csv', 'compact', 'flat']) {
    for (const showStreams of [false, true]) {
      it(`selects ${selector} records with ${printFormat}, streams=${showStreams}`, async () => {
        const streams = JSON.parse(formatFfprobeResult(probe, { ...opts, showPackets: false, showFrames: false, selectStreams: selector })).streams;
        const indices = new Set(streams.map((stream: { index: number }) => stream.index));
        const selected = { ...probe, streams, packets: probe.packets!.filter(row => indices.has(row.stream_index)), frames: probe.frames!.filter(row => indices.has(row.stream_index)) };
        const options = { ...opts, printFormat, showStreams, showEntries: 'packet=pts:frame=pts' };
        const expected = formatFfprobeResult(selected, options);
        expect(formatFfprobeResult(probe, { ...options, selectStreams: selector })).toBe(expected);
        let output = '';
        for await (const part of formatFfprobeSourceChunks({ ...probe, streams: rows(probe.streams), packets: rows(probe.packets!), frames: rows(probe.frames!) }, { ...options, selectStreams: selector })) output += part;
        expect(output).toBe(expected);
      });
    }
  }
}

it.each(['v:0', 'a:0'])('filters command records for %s', async selector => {
  const { MemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const { createCommandArguments } = await import('safe-bash-contracts/command');
  const { createFfprobeCommand } = await import('./media.js');
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', bytes);
  let output = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe',
    ...createCommandArguments(['-v', 'error', '-select_streams', selector, '-show_packets', '-show_frames', '-of', 'json', '/input.mp4']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write() { throw new Error('unexpected diagnostic'); } }
  });
  expect(result.exitCode).toBe(0);
  const records = JSON.parse(output);
  const video = selector === 'v:0';
  expect(records.packets).toHaveLength(video ? 5 : 9);
  expect(records.frames).toHaveLength(video ? 5 : 8);
  expect(records.packets.every((row: { codec_type: string }) => row.codec_type === (video ? 'video' : 'audio'))).toBe(true);
  expect(records.frames.every((row: { media_type: string }) => row.media_type === (video ? 'video' : 'audio'))).toBe(true);
});
