import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand } from './media.js';

for (const [fixture, audioPackets, videoFrames] of [
  ['packet-positions-interleaved.mp4', 9, 5], ['aac-external.mp4', 189, 80]
] as const) for (const route of ['file', 'stdin', 'stream']) for (const showFrames of [false, true]) {
  it(`excludes AAC priming from decoded frames: ${fixture}, ${route}, frames=${showFrames}`, async () => {
    const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
    const base = new MemoryFileSystem();
    await base.writeFile('/input.mp4', bytes);
    const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
    const fs = route === 'stream' ? new Proxy(base, { get(target, key) {
      if (key === 'capabilities') return capabilities;
      if (key === 'capabilitiesFor') return async () => capabilities;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) : base;
    let output = '', diagnostic = '';
    const result = await createFfprobeCommand().execute({
      command: 'ffprobe', ...createCommandArguments([
        '-count_frames', '-count_packets', ...(showFrames ? ['-show_frames'] : []),
        '-show_entries', 'stream=codec_type,nb_frames,nb_read_frames,nb_read_packets' +
          (showFrames ? ':frame=media_type,stream_index,pts,nb_samples' : ''),
        '-of', 'json', route === 'stdin' ? '-' : '/input.mp4'
      ]), cwd: '/', env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const probe = JSON.parse(output);
    expect(probe.streams).toEqual([
      { codec_type: 'video', nb_frames: String(videoFrames), nb_read_frames: String(videoFrames), nb_read_packets: String(videoFrames) },
      { codec_type: 'audio', nb_frames: String(audioPackets), nb_read_frames: String(audioPackets - 1), nb_read_packets: String(audioPackets) }
    ]);
    if (showFrames) {
      const audio = probe.frames.filter((frame: { media_type: string }) => frame.media_type === 'audio');
      expect(audio).toHaveLength(audioPackets - 1);
      expect(audio[0]).toEqual({ media_type: 'audio', stream_index: 1, pts: 0, nb_samples: 1024 });
      expect(probe.frames).toHaveLength(videoFrames + audioPackets - 1);
    }
  });
}

for (const route of ['file', 'stdin', 'stream']) it(`reports AAC priming packet metadata: ${route}`, async () => {
  const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url));
  const base = new MemoryFileSystem();
  await base.writeFile('/input.mp4', bytes);
  const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
  const fs = route === 'stream' ? new Proxy(base, { get(target, key) {
    if (key === 'capabilities') return capabilities;
    if (key === 'capabilitiesFor') return async () => capabilities;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) : base;
  let output = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe', ...createCommandArguments([
      '-v', 'error', '-select_streams', 'a:0', '-show_packets',
      '-show_entries', 'packet=pts,flags:packet_side_data=side_data_type,skip_samples,discard_padding',
      '-of', 'json', route === 'stdin' ? '-' : '/input.mp4'
    ]), cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  const { packets } = JSON.parse(output);
  expect(packets).toHaveLength(9);
  expect(packets[0]).toEqual({ pts: -1024, flags: 'KD_', side_data_list: [
    { side_data_type: 'Skip Samples', skip_samples: 1024, discard_padding: 0 }
  ] });
  expect(packets[1]).toEqual({ pts: 0, flags: 'K__' });
});
