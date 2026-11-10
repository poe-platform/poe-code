import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Samples and acceptance checked against FFmpeg 7.0.2.
for (const [expression, expected] of [
  ["0b1*c0", null],
  ["0o10*c0", null],
  ["0x1p-1*c0", [500, 200, -400, 800]],
  ["0x1*c0", [1000, 400, -800, 1600]],
  ["0.5*c0", [500, 200, -400, 800]],
  ["0XAp-4*c0", [625, 250, -500, 1000]],
  ["0x1.8p-1*c0", [750, 300, -600, 1200]],
  ["0x.8*c0", [500, 200, -400, 800]],
  ["-0x1p-1*c0", [-500, -200, 400, -800]],
  ["+0x1p-1*c0", [500, 200, -400, 800]],
  ["0x1p+1*c0", [2000, 800, -1600, 3200]],
  ["0x1e*c0", [30000, 12000, -24000, 32767]],
  ["0x1p*c0", [1000, 400, -800, 1600]],
  ["0x1p+*c0", [1000, 400, -800, 1600]],
  ["0x1p-1*c0+0x1p-2*c1", [0, 400, -100, 700]],
  ["0x*c0", null],
  ["0x.p1*c0", null],
  ["0x1.2.3*c0", null],
  ["0x1g*c0", null]
] as const) {
  for (const complex of [false, true]) {
    it(`matches native pan radix syntax (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      const samples = [1000, -2000, 400, 800, -800, 1200, 1600, -400];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/mix.raw", input);
      let stderr = "";
      const filter = `pan=mono|c0=${expression}`;
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/mix.raw",
          ...filters, "-f", "s16le", "/out.raw"],
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
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, expected.length * 2);
        assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}
