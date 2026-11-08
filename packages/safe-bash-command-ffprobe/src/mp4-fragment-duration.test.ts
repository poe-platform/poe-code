import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// ffmpeg -f lavfi -i sine=frequency=523:duration=0.5 -ar 22050 -ac 1
// -c:a aac -b:a 64k -movflags frag_keyframe+empty_moov -f mp4 pipe:1
const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/fragmented-aac.mp4', import.meta.url));

for (const input of ['/clip.mp4', '-']) {
  it(`reports native fragmented AAC timing and bitrates from ${input}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-show_entries',
        'stream=duration,bit_rate:format=duration,size,bit_rate', '-of', 'default', '-i', input]),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(output).toBe('[STREAM]\nduration=0.546440\nbit_rate=59425\n[/STREAM]\n' +
      '[FORMAT]\nduration=0.546440\nsize=5070\nbit_rate=74225\n[/FORMAT]\n');
  });
}
