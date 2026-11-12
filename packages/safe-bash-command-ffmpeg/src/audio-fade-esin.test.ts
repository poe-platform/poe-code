import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { audioFadeCurves } from "./audio-fade-curves.js";

// Exact samples from FFmpeg 7.0.2-static (Linux x86-64), including the
// double result before PCM16 conversion and the matching linear controls.
for (const [curve, format, expected] of [
  ["esin", "f64le", 0.0030975341796875],
  ["esin", "s16le", 102],
  ["tri", "f64le", 0.0035321892965370872],
  ["tri", "s16le", 116]
] as const) {
  for (const graph of [false, true]) {
    it(`afade ${curve} matches native double input to ${format} (graph=${graph})`, async () => {
      const input = Buffer.alloc(10 * 8);
      input.writeDoubleLE(0.012362662537879807, 3 * 8);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const filter = `afade=t=in:ss=1:ns=7:c=${curve}`;
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
      if (format === "f64le") reference.writeDoubleLE(expected, 3 * 8);
      else reference.writeInt16LE(expected, 3 * 2);
      assert.deepEqual(Buffer.concat(output), reference);
    });
  }
}

// Unit-amplitude double samples cover both halves and the native endpoints.
it("esin gains match native FFmpeg across a seven-sample fade", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => audioFadeCurves.esin!(index / 7)), [
    0, 0.12202189619125958, 0.2505555878595329, 0.29127594752255437,
    0.29451419756316366, 0.33793272765418336, 0.5212992069858159, 0.9999999999999999
  ]);
});
