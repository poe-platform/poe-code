import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseMp4, serializeMp4, probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

const base = parseMp4(readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url)));
// ffprobe's signed fixed-point coefficients, including its row labels and padding.
for (const [name, matrix, rotation, displaymatrix] of [
  ['identity', [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824], 0, undefined],
  ['turn', [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824], 90,
    '\n00000000:            0      -65536           0\n00000001:        65536           0           0\n00000002:            0           0  1073741824\n'],
  ['translation', [65536, 0, 0, 0, 65536, 0, 196608, 131072, 1073741824], 0,
    '\n00000000:        65536           0           0\n00000001:            0       65536           0\n00000002:       196608      131072  1073741824\n'],
  ['reflection', [65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824], 0,
    '\n00000000:        65536           0           0\n00000001:            0      -65536           0\n00000002:            0           0  1073741824\n'],
  ['scale', [131072, 0, 0, 0, 196608, 0, 0, 0, 1073741824], 0,
    '\n00000000:       131072           0           0\n00000001:            0      196608           0\n00000002:            0           0  1073741824\n']
] as const) it(`exposes the ${name} MP4 display matrix through all probe routes`, async () => {
  const bytes = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, matrix, rotation: undefined })) });
  const expected = displaymatrix ? [{ side_data_type: 'Display Matrix', displaymatrix, rotation }] : undefined;
  expect(probeMp4(bytes).streams[0]?.side_data_list).toEqual(expected);
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', bytes);
  for (const target of ['/input.mp4', '-']) for (const selection of [
    ['-show_streams'], ['-show_entries', 'stream=index:stream_side_data=side_data_type,displaymatrix,rotation']
  ]) {
    const args = ['-v', 'error', ...selection, '-of', 'json', target];
    let output = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).streams[0].side_data_list).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(target === '-' ? bytes : undefined, args, () => bytes)!).streams[0].side_data_list).toEqual(expected);
  }
});
