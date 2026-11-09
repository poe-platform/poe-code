import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg rounds float half steps to even directly at PCM8 precision.
for (const format of ["u8", "wav"]) {
  for (const filter of [false, true]) {
    it(`rounds floating-point half steps to unsigned PCM8 in ${format}${filter ? " after volume" : ""}`, async () => {
      const samples = [-127, -3, -1, 1, 63, 127].map(value => value / 256);
      samples.push(-0.75, -0.25, 0, 0.25, 0.75, -2, 2);
      samples.push(-1 / 256 - 1 / 65536, -1 / 256 + 1 / 65536, 1 / 256 - 1 / 65536, 1 / 256 + 1 / 65536);
      const input = Buffer.alloc(samples.length * 4);
      samples.forEach((sample, i) => input.writeFloatLE(sample * (filter ? 2 : 1), i * 4));
      const fs = Volume.fromJSON({ "/out": "keep" });
      fs.writeFileSync("/in", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "f32le", "-ar", "8000", "-ac", "1", "-i", "/in",
          ...(filter ? ["-af", "volume=0.5:precision=float"] : []), "-c:a", "pcm_u8", "-f", format, "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out") as Buffer;
      const pcm = format === "wav" ? Buffer.concat(parseWav(output).tracks[0]!.samples.map(sample => sample.data)) : output;
      assert.deepEqual([...pcm], [64, 126, 128, 128, 160, 192, 32, 96, 128, 160, 224, 0, 255, 127, 128, 128, 129]);
    });
  }
}
