import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Extensible PCM16 WAV, 8 kHz, with an 8192 impulse in each 5.1 speaker.
const input = Buffer.from("52494646a600000057415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636312e312e31303000006461746148000000002000000000000000000000000000200000000000000000000000000020000000000000000000000000002000000000000000000000000000200000000000000000000000000020", "hex");
// Native FFmpeg PCM16: center reaches both channels, surrounds their own side, LFE neither.
const stereo = [[8192, 0, 5793, 0, 5793, 0], [0, 8192, 5793, 0, 0, 5793]];
const surround = Array.from({ length: 6 }, (_, channel) =>
  Array.from({ length: 6 }, (_, frame) => frame === channel ? 8192 : 0));

for (const mask of [0x3f, 0x60f]) for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["", surround],
    ["anull", surround],
    ["extrastereo=m=1", stereo],
    ["stereotools", stereo],
    ["extrastereo=m=-1", [stereo[1]!, stereo[0]!]],
    ["stereotools=muter=1", [stereo[0]!, [0, 0, 0, 0, 0, 0]]],
    ["extrastereo=m=1,stereotools", stereo],
    ["pan=stereo|FL=FL|FR=FR,extrastereo=m=1", surround.slice(0, 2)]
  ] as const) {
    it(`negotiates 5.1 mask ${mask} for ${filter || "no filter"} (${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      const wav = Buffer.from(input);
      wav.writeUInt32LE(mask, 40);
      volume.writeFileSync("/in.wav", wav);
      let stderr = "";
      const filters = !filter ? [] : complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.channels, expected.length);
      assert.equal(audio.sampleRate, 8000);
      if (expected.length === 6) assert.equal(audio.channelMask, mask);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}
