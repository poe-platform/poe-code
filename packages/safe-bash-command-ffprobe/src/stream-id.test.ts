import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseMp4Boxes } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

const bytes = new Uint8Array(readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url)));
const tracks = parseMp4Boxes(bytes).find(box => box.type === 'moov')!.children!.filter(box => box.type === 'trak');
for (const [index, track] of tracks.entries()) {
  const header = track.children!.find(box => box.type === 'tkhd')!.payload;
  new DataView(header.buffer, header.byteOffset, header.byteLength).setUint32(header[0] === 1 ? 20 : 12, index === 0 ? 42 : 77);
}

it.each([
  ['i:77', [1]], ['#0x4d', [1]], ['i:0x4D', [1]], ['#77', [1]],
  ['i:42', [0]], ['i:99', []], ['#0x63', []], ['i:1', []],
  ['a:0', [1]], ['1', [1]],
] as const)('selects MP4 track IDs for %s in sync and streaming commands', async (selector, indices) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', bytes);
  const args = ['-v', 'error', '-select_streams', selector, '-show_streams', '-show_entries', 'stream=index,id', '-of', 'json', '/input.mp4'];
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
    expect(JSON.parse(text).streams).toEqual(indices.map(index => ({ index, id: index === 0 ? '0x2a' : '0x4d' })));
  }
});
