import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { audioFadeCurves } from "./audio-fade-curves.js";

// Exact samples from FFmpeg 7.0.2-static (Linux x86-64), including the
// double result before PCM16 conversion and the matching linear controls.
for (const [curve, format, expected] of [
  ["ihsin", "f64le", 0.0030670166015625],
  ["ihsin", "s16le", 100],
  ["tri", "f64le", 0.0034900462744160334],
  ["tri", "s16le", 114]
] as const) {
  for (const graph of [false, true]) {
    it(`afade ${curve} matches native double input to ${format} (graph=${graph})`, async () => {
      const input = Buffer.alloc(10 * 8);
      input.writeDoubleLE(0.004071720653485373, 2 * 8);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const filter = `afade=t=out:ss=1:ns=7:c=${curve}`;
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", format, "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      const reference = Buffer.alloc(10 * (format === "f64le" ? 8 : 2));
      if (format === "f64le") reference.writeDoubleLE(expected, 2 * 8);
      else reference.writeInt16LE(expected, 2 * 2);
      assert.deepEqual(Buffer.concat(output), reference);
    });
  }
}

// Unit-amplitude double samples cover both halves and the native endpoints.
it("ihsin gains match native FFmpeg across a seven-sample fade", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => audioFadeCurves.ihsin!(index / 7)), [
    0, 0.24675171442884988, 0.3590170359713761, 0.4543710516570101,
    0.5456289483429899, 0.640982964028624, 0.7532482855711501, 1
  ]);
});
