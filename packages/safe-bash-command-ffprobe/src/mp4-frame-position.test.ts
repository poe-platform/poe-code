import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

// Native ffprobe -select_streams v:0 -show_frames -show_entries frame=pts,pkt_pos.
for (const [layout, start, positions] of [
  ['faststart', 0, ['902', '2011', '2085', '2162', '2240']],
  ['interleaved', 0, ['1567', '2676', '3349', '4403', '5241']],
  ['fragmented', 4096, ['1577', '2686', '2760', '2837', '2915']]
] as const) {
  const expected = positions.map((pkt_pos, i) => ({ pts: start + i * 2048, pkt_pos }));
  for (const selected of [false, true]) it(`reports native MP4 frame positions: ${layout}, selected=${selected}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/packet-positions-${layout}.mp4`, import.meta.url));
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input.mp4', bytes);
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe',
      ...createCommandArguments(['-v', 'error', '-select_streams', 'v:0', '-show_frames',
        ...(selected ? ['-show_entries', 'frame=pts,pkt_pos'] : []), '-of', 'json', '/input.mp4']),
      cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    // Video records precede audio records in the source iterator.
    const frames = JSON.parse(output).frames.slice(0, expected.length);
    if (selected) expect(frames).toEqual(expected);
    else expect(frames).toMatchObject(expected);
  });
  it(`reports native MP4 frame positions through the SDK: ${layout}`, () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/packet-positions-${layout}.mp4`, import.meta.url));
    const frames = probeMp4(bytes, { showFrames: true }).frames!.filter(frame => frame.media_type === 'video');
    expect(frames.map(frame => frame.pkt_pos)).toEqual(positions);
  });
}
