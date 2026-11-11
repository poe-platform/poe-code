import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95];
// Native FFmpeg output, scaled by 32768; signed zeros survive floating-point encoding.
const cases = [
  ["stereotools", samples],
  ["stereotools=mutel=1", [0, -2000, 0, 1234, -0, 909, 0, -32000, 0, -33, 0, 95]],
  ["stereotools=mutel=1:phasel=1", [0, -2000, -0, 1234, 0, 909, 0, -32000, 0, -33, -0, 95]],
  ["stereotools=muter=1", [1000, 0, 3000, 0, -527, 0, 32767, 0, 17, 0, 94, 0]],
  ["stereotools=muter=1:phaser=1", [1000, 0, 3000, 0, -527, 0, 32767, 0, 17, 0, 94, 0]]
] as const;

for (const [filter, expectedSamples] of cases) {
  for (const format of ["f64le", "f32le", "s16le"] as const) {
    for (const graph of [false, true]) {
      it(`preserves native mute bytes for ${filter}, ${format}, ${graph ? "graph" : "simple"}`, async () => {
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const bytes = format === "f64le" ? 8 : format === "f32le" ? 4 : 2;
        const expected = Buffer.alloc(expectedSamples.length * bytes);
        expectedSamples.forEach((sample, index) => {
          if (format === "f64le") expected.writeDoubleLE(sample / 32768, index * bytes);
          else if (format === "f32le") expected.writeFloatLE(sample / 32768, index * bytes);
          else expected.writeInt16LE(sample, index * bytes);
        });
        const fs = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", format, "/out.raw"],
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
        assert.deepEqual(fs.readFileSync("/out.raw"), expected);
      });
    }
  }
}
