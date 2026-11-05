import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const fixture of ['packet-positions-faststart.mp4', 'packet-positions-interleaved.mp4']) {
  for (const fields of [undefined, 'duration', 'duration,duration_time,pkt_duration,pkt_duration_time']) {
    it(`emits native MP4 frame duration fields for ${fixture}, fields=${fields}`, async () => {
      const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
      const fs = new MemoryFileSystem();
      await fs.writeFile('/input.mp4', bytes);
      let output = '', diagnostic = '';
      const result = await createFfprobeCommand().execute({
        command: 'ffprobe',
        ...createCommandArguments(['-v', 'error', '-select_streams', 'v:0', '-show_frames',
          ...(fields ? ['-show_entries', `frame=${fields}`] : []), '-of', 'json', '/input.mp4']),
        cwd: '/', env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const frames = JSON.parse(output).frames;
      expect(frames).toHaveLength(fixture === 'packet-positions-faststart.mp4' ? 5 : 14);
      for (const frame of frames.slice(0, 5)) {
        // Native ffprobe: video frames each last 2048 / 10240 seconds.
        const expected = { duration: 2048, ...(fields === 'duration' ? {} : { duration_time: '0.200000' }) };
        if (fields) expect(frame).toEqual(expected);
        else expect(frame).toMatchObject(expected);
        expect(frame).not.toHaveProperty('pkt_duration');
        expect(frame).not.toHaveProperty('pkt_duration_time');
      }
    });
  }
  it(`emits native duration fields through the SDK for ${fixture}`, () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
    const result = probeMp4(bytes, { showFrames: true, showPackets: true });
    const frames = result.frames!.filter(frame => frame.media_type === 'video');
    expect(frames).toHaveLength(5);
    for (const frame of frames) {
      expect(frame).toMatchObject({ duration: 2048, duration_time: '0.200000' });
      expect(frame).not.toHaveProperty('pkt_duration');
      expect(frame).not.toHaveProperty('pkt_duration_time');
    }
    expect(result.packets!.filter(packet => packet.codec_type === 'video')[0])
      .toMatchObject({ duration: 2048, duration_time: '0.200000' });
  });
}
