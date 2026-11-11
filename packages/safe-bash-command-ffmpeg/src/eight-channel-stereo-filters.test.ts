import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [6, 8]) for (const complex of [false, true]) {
  for (const filter of ["stereotools", "extrastereo=m=1", "stereowiden=feedback=0:crossfeed=0:drymix=1"]) {
    it(`remixes unmasked ${channels}-channel WAV before ${filter} (${complex ? "graph" : "simple"})`, async () => {
      // Basic PCM header, with a mixed frame followed by one impulse per speaker.
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, channel) =>
        Float64Array.from([100 * channel + 17, ...Array.from({ length: channels }, (_, frame) =>
          frame === channel ? 8192 : 0)], sample => sample / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      // Native FFmpeg PCM16: both surround pairs feed their own side at sqrt(1/2), excluding LFE.
      const expected = [channels === 8 ? 902 : 465, channels === 8 ? 1143 : 636,
        8192, 0, 0, 8192, 5793, 5793, 0, 0, 5793, 0, 0, 5793,
        ...(channels === 8 ? [5793, 0, 0, 5793] : [])];
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(expected.map((_, index) => pcm.readInt16LE(index * 2)), expected);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
