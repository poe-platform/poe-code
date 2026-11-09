import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 requests enough samples from input 0 before requesting input 1.
// EOF at or before the window size on input 0 therefore produces no output.
for (const channels of [1, 2]) for (const filter of ["axcorrelate=128:slow", "axcorrelate=128:fast", "axcorrelate=128:best", "axcorrelate"]) {
  const size = filter === "axcorrelate" ? 256 : 128;
  for (const shortLength of [size - 31, size, size + 1]) for (const swap of [false, true]) {
    it(`${filter} honors first-input EOF with ${shortLength} samples (${channels} channels, swapped=${swap})`, async () => {
      const fs = Volume.fromJSON({});
      for (const length of [shortLength, 4096]) {
        const samples = Float64Array.from({ length }, (_, i) => i % 8 < 4 ? 0.25 : -0.25);
        fs.writeFileSync(`/${length}.wav`, encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, () => samples) }));
      }
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-i", `/${swap ? 4096 : shortLength}.wav`, "-i", `/${swap ? shortLength : 4096}.wav`,
          "-filter_complex", `[0:a][1:a]${filter}[out]`, "-map", "[out]", "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const expectedLength = !swap && shortLength <= size ? 0 : shortLength;
      assert.equal(fs.readFileSync("/out.pcm").length, expectedLength * channels * 2);
    });
  }
}
