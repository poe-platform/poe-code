import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [mask, firstFrame] of [
  [0x60f, [100, 200, 300, 400, 0, 0, 500, 600]],
  [0x3f, [100, 200, 300, 400, 500, 600, 0, 0]]
] as const) {
  it(`routes mask ${mask} to the matching 7.1 speakers`, async () => {
    const channels = 6;
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [Array.from({ length: channels }, (_, i) => (i + 1) * 100),
      Array.from({ length: channels }, (_, i) => -(i + 1) * 100)];
    const input = Buffer.alloc(header.length + frames.length * channels * 2);
    input.set(header);
    input.writeUInt16LE(channels, 22);
    input.writeUInt32LE(8000 * channels * 2, 28);
    input.writeUInt16LE(channels * 2, 32);
    input.writeUInt32LE(mask, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-ac", "8", "/out.wav"],
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
    assert.equal(audio.channels, 8);
    assert.equal(audio.channelMask, 0x63f);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, frames.length);
    // Native FFmpeg's 7.1 output preserves each named speaker and fills silence.
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)),
      [...firstFrame, ...firstFrame.map(sample => sample === 0 ? 0 : -sample)]);
  });
}
