import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2, 6]) {
  it(`downmixes every 7.1 speaker to ${channels} channels like FFmpeg`, async () => {
    // Native FFmpeg extensible PCM16 WAV header; channel order FL, FR, FC, LFE, surrounds.
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [12000, -12000].flatMap(level =>
      Array.from({ length: 8 }, (_, active) => Array.from({ length: 8 }, (_, c) => c === active ? level : 0)));
    const input = Buffer.alloc(header.length + frames.length * 16);
    input.set(header);
    input.writeUInt16LE(8, 22);
    input.writeUInt32LE(128000, 28);
    input.writeUInt16LE(16, 32);
    input.writeUInt32LE(0x63f, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-ac", String(channels), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, channels);
    assert.equal(audio.channelMask ?? (channels === 1 ? 4 : 3), channels === 6 ? 0x3f : channels === 1 ? 4 : 3);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, frames.length);
    // Native FFmpeg reference: FL, FR, FC, LFE, BL, BR, SL, SR impulses.
    const expected = channels === 1 ? [[1922], [1922], [2718], [0], [1359], [1359], [1359], [1359]]
      : channels === 2 ? [[3844, 0], [0, 3844], [2719, 2719], [0, 0], [2718, 0], [0, 2718], [2718, 0], [0, 2718]]
      : [[7029, 0, 0, 0, 0, 0], [0, 7029, 0, 0, 0, 0], [0, 0, 7029, 0, 0, 0],
        [0, 0, 0, 7029, 0, 0], [0, 0, 0, 0, 7029, 0], [0, 0, 0, 0, 0, 7029],
        [0, 0, 0, 0, 4971, 0], [0, 0, 0, 0, 0, 4971]];
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)),
      [...expected.flat(), ...expected.flat().map(value => value === 0 ? 0 : -value)]);
  });
}
