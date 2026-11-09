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
  ['i:0115', [1]], ['#+77', [1]], ['i:+0x4D', [1]], ['#-1', []],
  ['i:42', [0]], ['i:99', []], ['#0x63', []], ['i:1', []],
  ['a:0', [1]], ['1', [1]], ['0x1', [1]], ['a:0X0', [1]], ['#1', []],
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

const transport = new Uint8Array(readFileSync(new URL('./fixtures/programs.mpegts', import.meta.url)));

// Native ffprobe selects PID 257 (stream 1) for decimal 257, octal 0401 and hex 0x101.
for (const prefix of ['#', 'i:', 'a:#', 'a:i:']) {
  for (const entries of ['stream=index', 'packet=stream_index']) {
    it.each([
      ['257', [1]], ['0401', [1]], ['0x101', [1]],
      ['+257', [1]], ['+0401', [1]], ['+0X101', [1]],
      ['-1', []], ['-0401', []], ['-0x101', []], ['0', []],
    ] as const)(`selects MPEG-TS ${entries} with ${prefix}%s`, async (id, indices) => {
      for (const route of ['file', 'stdin', 'sync']) {
        const args = ['-v', 'error', '-select_streams', prefix + id,
          '-show_entries', entries, '-of', 'json', route === 'stdin' ? '-' : '/input.ts'];
        let output = '', diagnostic = '';
        if (route === 'sync') output = evalSyncFfprobe(undefined, args, () => transport) ?? '';
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile('/input.ts', transport);
          const result = await createFfprobeCommand().execute({
            command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield transport; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe('');
        }
        const parsed = JSON.parse(output);
        if (entries === 'stream=index') expect(parsed.streams).toEqual(indices.map(index => ({ index })));
        else expect([...new Set(parsed.packets.map((packet: { stream_index: number }) => packet.stream_index))]).toEqual(indices);
      }
    });
  }
}
