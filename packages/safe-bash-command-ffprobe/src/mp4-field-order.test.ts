import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Interlaced fixtures: ffmpeg -f lavfi -i testsrc2=size=32x32:rate=25
// -frames:v 2 -c:v libx264 -flags +ilme+ildct -x264-params tff=1 (or bff=1).
// Expected orders independently verified with native ffprobe on identical bytes.
for (const [fixture, fieldOrder] of [
  ['packet-positions-faststart', 'progressive'],
  ['packet-positions-interleaved', 'progressive'],
  ['packet-positions-fragmented', 'progressive'],
  ['aac-external', 'progressive'],
  ['h264-b-frames', 'progressive'],
  ['h264-picture-types', 'progressive'],
  ['h264-tff', 'tt'],
  ['h264-bff', 'bb']
] as const) {
  it(`reports native H.264 field order through ffprobe: ${fixture}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.mp4`, import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/clip.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments(['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_name,field_order', '-of', 'json', '/clip.mp4']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual([{ codec_name: 'h264', field_order: fieldOrder }]);
  });
}
