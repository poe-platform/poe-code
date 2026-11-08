import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const mask of [0x3f, 0x60f, 0x707]) {
  it(`downmixes supported 5.1 layouts to stereo and rejects unknown layouts: ${mask}`, async () => {
    // Native FFmpeg extensible PCM16 WAV header; channel order FL, FR, FC, LFE, surrounds.
    const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff", "hex");
    const frames = [
      [100, 200, 300, 400, 500, 600],
      ...Array.from({ length: 6 }, (_, active) => Array.from({ length: 6 }, (_, c) => c === active ? 16384 : 0)),
      [-100, -200, -300, -400, -500, -600]
    ];
    const input = Buffer.alloc(header.length + frames.length * 12);
    input.set(header);
    input.writeUInt32LE(mask, 40);
    frames.flat().forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-ac", "2", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (mask === 0x707) {
      assert.equal(result.exitCode, 1);
      assert.ok(stderr.includes("Unsupported audio channel layout"), stderr);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, frames.length);
    // Actual native FFmpeg PCM16 output for the frames above, for both layouts.
    assert.deepEqual(frames.flatMap((_, i) => audio.channelData.map(channel => channel[i]! * 32768)),
      [276, 346, 6787, 0, 0, 6787, 4799, 4799, 0, 0, 4799, 0, 0, 4799, -276, -346]);
  });
}
