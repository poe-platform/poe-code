import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1, 3, 5, 7, -1, -3, 30001, -31001];
const right = [80, 160, 240, 320, -400, -480, 555, -630];
const difference = [-79, -157, -235, -313, 399, 477, 29446, -30371];
const halfRight = [40, 80, 120, 160, -200, -240, 278, -315];

for (const [expression, expected] of [
  ["c0=c0-c1", difference],
  ["c0=c0+-1*c1", difference],
  ["c0=.5c1", halfRight],
  ["c0=0.5*c1", halfRight],
  ["c0=1e+0*c1", right],
  ["c0=5e-1c1", halfRight],
  ["c0=-1c1", right.map(sample => -sample)],
  ["c0=c0-1e-0*c1", difference],
  ["FC=FL-1E+0*FR", difference],
  ["c0=.5x*c1", null],
  ["c0=1e+*c1", null],
  ["c0=c0-", null],
  ["c0=c0+", null]
] as const) {
  for (const complex of [false, true]) {
    it(`parses pan gains (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const input = Buffer.alloc(left.length * 4);
      for (let i = 0; i < left.length; i++) {
        input.writeInt16LE(left[i]!, i * 4);
        input.writeInt16LE(right[i]!, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/lr.raw": input, "/out.raw": "keep" });
      let stderr = "";
      const filter = `pan=mono|${expression}`;
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
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
      if (expected === null) {
        assert.equal(result.exitCode, 234);
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
