import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

// FFmpeg: two 0.05s sine inputs, AAC, -program program_num=101:st=0
// -program program_num=202:st=1 -f mpegts.
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/programs.mpegts', import.meta.url)));

it.each([[101, [0]], [202, [1]], [999, []]] as const)('selects MPEG-TS program %s', async (programId, indices) => {
  const args = ['-v', 'error', '-select_streams', `p:${programId}`,
    '-show_entries', 'program=program_id:stream=index,id,codec_name', '-of', 'json', '/input.ts'];
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
    expect(parsed.programs).toEqual([101, 202].map((id, index) => ({
      program_id: id,
      streams: (indices as readonly number[]).includes(index) ? [{ index, id: `0x10${index}`, codec_name: 'aac' }] : []
    })));
    expect(parsed.streams).toEqual(indices.map(index => ({ index, id: `0x10${index}`, codec_name: 'aac' })));
  }
});

