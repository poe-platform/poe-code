import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { encodeWav } from '@poe-code/audio-ast';
import { formatFfprobeResult, formatFfprobeSourceChunks } from './media.js';

const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url));
const probe = probeMp4(bytes, { showPackets: true, showFrames: true });
const opts = { printFormat: 'json', showFormat: false, showStreams: true, showPackets: true, showFrames: true, showChapters: false, showPrograms: false };
async function* rows<T>(values: Iterable<T>) { yield* values; }

it.each([
  ['m:language:eng', [0]],
  ['m:language:fra', [1]],
  ['m:language:deu', []],
  ['m:language', [0, 1]],
  ['m:missing', []],
  ['m:title:Main:Audio', [1]],
  ['m:title:main:audio', []],
] as const)('matches stream metadata for %s', async (selector, indices) => {
  const tagged = { ...probe, streams: probe.streams.map(stream => ({
    ...stream, tags: { language: stream.index === 0 ? 'eng' : 'fra', title: stream.index === 0 ? 'Video' : 'Main:Audio' }
  })) };
  const expected = formatFfprobeResult({ ...tagged,
    streams: tagged.streams.filter(stream => (indices as readonly number[]).includes(stream.index)),
    packets: tagged.packets!.filter(packet => (indices as readonly number[]).includes(packet.stream_index)),
    frames: tagged.frames!.filter(frame => (indices as readonly number[]).includes(frame.stream_index)),
  }, opts);
  expect(formatFfprobeResult(tagged, { ...opts, selectStreams: selector })).toBe(expected);
  let output = '';
  for await (const part of formatFfprobeSourceChunks({ ...tagged, streams: rows(tagged.streams), packets: rows(tagged.packets!), frames: rows(tagged.frames!) }, { ...opts, selectStreams: selector })) output += part;
  expect(output).toBe(expected);
});

it.each(['m:language:eng', 'm:missing', '0', '1'])('filters untagged WAV packets for %s', async selector => {
  const { MemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const { createCommandArguments } = await import('safe-bash-contracts/command');
  const { createFfprobeCommand } = await import('./index.js');
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.wav', encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }));
  let output = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe',
    ...createCommandArguments(['-v', 'error', '-of', 'json', '-select_streams', selector, '-show_entries', 'packet=size', '/input.wav']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write() { throw new Error('unexpected diagnostic'); } }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).packets).toEqual(selector === '0' ? [{ size: '32' }] : []);
});

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
  const rows = JSON.parse(output).packets_and_frames;
  const records = { packets: rows.filter((row: { type: string }) => row.type === "packet"), frames: rows.filter((row: { type: string }) => row.type === "frame") };
  const video = selector === 'v:0';
  expect(records.packets).toHaveLength(video ? 5 : 9);
  expect(records.frames).toHaveLength(video ? 5 : 8);
  expect(records.packets.every((row: { codec_type: string }) => row.codec_type === (video ? 'video' : 'audio'))).toBe(true);
  expect(records.frames.every((row: { media_type: string }) => row.media_type === (video ? 'video' : 'audio'))).toBe(true);
});
