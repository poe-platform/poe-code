import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const mask of [7, 11]) {
 for (const channels of [1, 2]) {
  it(`downmixes three-channel mask ${mask} to ${channels} channels`, async () => {
    // Extensible PCM16 WAV: identical samples, with either FL/FR/FC or FL/FR/LFE.
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [[100, 200, 300], [400, 500, 600], [16384, 0, 0], [0, 16384, 0], [0, 0, 16384], [-100, -200, -300]];
    const input = Buffer.alloc(header.length + frames.length * 6);
    input.set(header);
    input.writeUInt16LE(3, 22);
    input.writeUInt32LE(48000, 28);
    input.writeUInt16LE(6, 32);
    input.writeUInt32LE(mask, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-ac", String(channels), "/out.wav"],
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
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, frames.length);
    // Captured native FFmpeg 7.0.2 output for identical PCM bytes with each mask.
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)),
      mask === 7 ? channels === 1 ? [212, 512, 4799, 4799, 6787, -212] : [183, 241, 483, 541, 9598, 0, 0, 9598, 6787, 6787, -183, -241]
        : channels === 1 ? [150, 450, 8192, 8192, 0, -150] : [100, 200, 400, 500, 16384, 0, 0, 16384, 0, 0, -100, -200]);
  });
 }
}
