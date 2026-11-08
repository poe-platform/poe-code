import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [channels, mask, targetMask, remixed] of [
  [3, 7, 11, [7029, 0, 0, 0, 7029, 0, 4971, 4971, 0]],
  [3, 11, 11, undefined],
  [4, 0x33, 0x107, [8485, 0, 0, 0, 0, 8485, 0, 0, 0, 0, 0, 6000, 0, 0, 0, 6000]],
  [6, 0x60f, 0x3f, undefined],
  [1, 1, undefined, undefined],
  [1, 2, undefined, undefined]
] as const) {
  for (const explicit of [false, true]) {
    for (const split of channels === 1 ? [false, true] : [false]) {
      it(`${explicit ? "normalizes" : "preserves"} ${channels} channels with mask ${mask}${split ? " from channelsplit" : ""}`, async () => {
        const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b7164617461ffffffff", "hex");
        const samples = Array.from({ length: channels * channels }, (_, i) => Math.floor(i / channels) === i % channels ? 12000 : 0);
        const input = Buffer.alloc(header.length + samples.length * 2);
        input.set(header);
        input.writeUInt16LE(channels, 22);
        input.writeUInt32LE(8000 * channels * 2, 28);
        input.writeUInt16LE(channels * 2, 32);
        input.writeUInt32LE(mask, 40);
        samples.forEach((sample, i) => input.writeInt16LE(sample, header.length + i * 2));
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", split ? encodeWav({ sampleRate: 8000,
          channels: [Float64Array.of(12000 / 32768), Float64Array.of(12000 / 32768)] }) : input);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(split ? ["-af", `channelsplit=channels=${mask === 1 ? "FL" : "FR"}`] : []), ...(explicit ? ["-ac", String(channels)] : []), "-c:a", "pcm_s16le", "/out.wav"],
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
        // Native FFmpeg PCM16 output for isolated speaker impulses.
        assert.deepEqual(samples.map((_, i) => audio.channelData[i % channels]![Math.floor(i / channels)]! * 32768), explicit && remixed ? remixed : samples);
        assert.equal(audio.channelMask, explicit ? targetMask : mask);
      });
    }
  }
}
