import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1, 3, 5, 7, -1, -3, 30001, -31001];
const right = [80, 160, 240, 320, -400, -480, 555, -630];
const silence = left.map(() => 0);

// Native FFmpeg 7.0.2 treats valid input channels absent from stereo as silence.
for (const [expression, expected] of [
  ["mono|c0=c2", silence],
  ["mono|c0=FC", silence],
  ["mono|c0=c0+c2", left],
  ["mono|c0=FL+FC", left],
  ["mono|c0=c63", silence],
  ["mono|c0=TBR", silence],
  ["mono|c0=WR", silence],
  ["mono|c0<2*c0+c2", left],
  ["mono|c0<2*FL+FC", left],
  ["mono|c0<c2", silence],
  ["mono|c0<FC", silence],
  ["mono|c0=Bogus", null],
  ["mono|c0=c999", null],
  ["mono|c0=c64", null],
  ["mono|c0=c-1", null],
  ["mono|FR=FL", null],
  ["mono|c1=c0", null],
  ["mono|c0=c2+Bogus", null],
  ["mono|c0=NaN*c2", silence]
] as const) {
  for (const complex of [false, true]) {
    it(`validates absent pan inputs (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const input = Buffer.alloc(left.length * 4);
      left.forEach((sample, index) => {
        input.writeInt16LE(sample, index * 4);
        input.writeInt16LE(right[index]!, index * 4 + 2);
      });
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      volume.writeFileSync("/lr.raw", input);
      const filters = complex
        ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
        : ["-af", `pan=${expression}`];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/lr.raw",
          ...filters, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.deepEqual(volume.readFileSync("/lr.raw"), input);
      if (expected === null) {
        assert.equal(result.exitCode, 234);
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
