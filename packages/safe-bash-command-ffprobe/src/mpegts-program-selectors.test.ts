import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

// FFmpeg: two 0.05s sine inputs, AAC, -program program_num=101:st=0
// -program program_num=202:st=1 -f mpegts.
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/programs.mpegts', import.meta.url)));

it.each([
  ['p:101', [0]], ['p:202', [1]], ['p:999', []],
  ['p:202:a:0', [1]], ['p:202:0', [1]], ['p:202:a', [1]],
  ['p:101:', [0]], ['p:101:v', []], ['p:999:a', []],
  ['p:202:1', []], ['p:202:a:1', []], ['a:p:202:0', [1]]
] as const)('selects MPEG-TS program streams and packets with %s', async (selector, indices) => {
  for (const entries of ['program=program_id:stream=index,id,codec_name:packet=stream_index', 'packet=stream_index']) {
    const args = ['-v', 'error', '-select_streams', selector,
      '-show_entries', entries, '-of', 'json', '/input.ts'];
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input.ts', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
      const parsed = JSON.parse(text);
      expect([...new Set(parsed.packets.map((packet: { stream_index: number }) => packet.stream_index))]).toEqual(indices);
      if (entries === 'packet=stream_index') continue;
      expect(parsed.programs).toEqual([101, 202].map((id, index) => ({
        program_id: id,
        streams: (indices as readonly number[]).includes(index) ? [{ index, id: `0x10${index}`, codec_name: 'aac' }] : []
      })));
      expect(parsed.streams).toEqual(indices.map(index => ({ index, id: `0x10${index}`, codec_name: 'aac' })));
    }
  }
});

