import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1, 3, 5, 7, -1, -3, 30001, -31001];
const right = [80, 160, 240, 320, -400, -480, 555, -630];
const silence = left.map(() => 0);

// Native FFmpeg 7.0.2 PCM16 output, in speaker order.
for (const [filter, channels, mask] of [
  ["pan=3c|LFE=c1", [silence, silence, right], 0xb],
  ["pan=4c|BC=c1", [silence, silence, silence, right], 0x107],
  ["pan=5c|BL=c1|BR=c0", [silence, silence, silence, right, left], 0x37],
  ["pan=7c|BC=c1|SR=c0", [silence, silence, silence, silence, right, silence, left], 0x70f],
  ["pan=8c|BL=c1|SR=c0", [silence, silence, silence, silence, right, silence, silence, left], 0x63f],
  ["pan=3c|c2=c1", [silence, silence, right], 0xb],
  ["pan=4c|c3=c1", [silence, silence, silence, right], 0x107],
  ["pan=5c|c4=c1", [silence, silence, silence, silence, right], 0x37],
  ["pan=7c|c6=c1", [silence, silence, silence, silence, silence, silence, right], 0x70f],
  ["pan=8c|c7=c1", [silence, silence, silence, silence, silence, silence, silence, right], 0x63f],
  ["pan=2 channels (FL+FR)|FL=FR", [right, silence], 3],
  ["pan=3 channels (FL+FR+FC)|c0=c1", [right, silence, silence], 7],
  ["pan=1 channels (FC)|c0=c1", [right], 4],
  ["pan=5.1|FC=c1|LFE=c0", [silence, silence, right, left, silence, silence], 0x3f],
  ["pan=quad|BL=c1|BR=c0", [silence, silence, right, left], 0x33],
  ["pan=stereo|FL=FR|FR=FL", [right, left], 3],
  ["pan=0x3|FL=FR|FR=FL", [right, left], 3],
  ["pan=FL+FR|FL=FR|FR=FL", [right, left], 3],
  ["pan=5.1|FC=c1|LFE=c0,pan=stereo|FL=FC|FR=LFE", [right, left], 3],
  ["pan=quad|BL=c1|BR=c0,pan=stereo|FL=BL|FR=BR", [right, left], 3]
] as const) {
  for (const complex of [false, true]) {
    for (const format of ["s16le", "wav"]) {
      it(`resolves pan layouts (${complex ? "graph" : "simple"}, ${format}): ${filter}`, async () => {
        const input = Buffer.alloc(left.length * 4);
        left.forEach((sample, i) => {
          input.writeInt16LE(sample, i * 4);
          input.writeInt16LE(right[i]!, i * 4 + 2);
        });
        const volume = Volume.fromJSON({ "/out": "keep" });
        volume.writeFileSync("/lr.raw", input);
        const filters = complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
          : ["-af", filter];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/lr.raw",
            ...filters, "-c:a", "pcm_s16le", "-f", format, "/out"],
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
        const bytes = volume.readFileSync("/out") as Buffer;
        if (format === "s16le") {
          const expected = left.flatMap((_, frame) => channels.map(channel => channel[frame]!));
          assert.equal(bytes.length, expected.length * 2);
          assert.deepEqual(expected.map((_, i) => bytes.readInt16LE(i * 2)), expected);
        } else {
          const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
          assert.equal(audio.channels, channels.length);
          assert.equal(audio.sampleRate, 8000);
          if (channels.length > 2) assert.equal(audio.channelMask, mask);
          assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), channels);
        }
      });
    }
  }
}
