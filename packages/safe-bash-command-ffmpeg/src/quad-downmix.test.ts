import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2, 4]) {
  const mask = 0x33;
  it(`downmixes quad WAV to ${channels} channels`, async () => {
    // Extensible PCM16 WAV with FL/FR/BL/BR ordering.
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [[100, 200, 300, 400], [500, 600, 100, 200], [300, 400, 500, 600], [16384, 0, 0, 0], [0, 16384, 0, 0], [0, 0, 16384, 0], [0, 0, 0, 16384], [-100, -200, -300, -400]];
    const input = Buffer.alloc(header.length + frames.length * 8);
    input.set(header);
    input.writeUInt16LE(4, 22);
    input.writeUInt32LE(64000, 28);
    input.writeUInt16LE(8, 32);
    input.writeUInt32LE(mask, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(channels === 4 ? ["-c:a", "copy"] : ["-ac", String(channels)]), "/out.wav"],
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
    if (channels === 4) assert.equal(audio.channelMask, mask);
    // Captured native FFmpeg PCM16 output, including each isolated speaker.
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)),
      channels === 4 ? frames.flat() : channels === 1
        ? [233, 384, 433, 4799, 4799, 3393, 3393, -233]
        : [183, 283, 334, 434, 383, 483, 9598, 0, 0, 9598, 6787, 0, 0, 6787, -183, -283]);
  });
}
