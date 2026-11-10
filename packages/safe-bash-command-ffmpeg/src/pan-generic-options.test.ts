import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 keeps these right-channel samples unchanged by scheduling options.
const samples = [1, 4, 3, -4, -3, 6, 301, 711, 12001, -31999, 30000, 30000, -30000, -30000, 32767, -32768];
for (const [options, status] of [
  ["", 0], [":threads=1", 0], [":thread_type=slice", 0], [":extra_hw_frames=1", 0],
  [":threads=2:thread_type=slice:extra_hw_frames=-1", 0],
  [":threads=0:thread_type=0:extra_hw_frames=0", 0],
  [":threads=1+1", 0], [":threads=1:", 0],
  [":threads=-1", 222], [":threads=2147483648", 222], [":extra_hw_frames=-2", 222],
  [":threads=", 234], [":threads=NaN", 234], [":thread_type=bogus", 234],
  [":unknown=1", 8]
] as const) {
  for (const complex of [false, true]) {
    it(`handles pan generic options (${complex ? "graph" : "simple"}): ${options || "control"}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `pan=mono|c0=c1${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      if (status === 0) {
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 16);
        assert.deepEqual(Array.from({ length: 8 }, (_, i) => output.readInt16LE(i * 2)),
          [4, -4, 6, 711, -31999, 30000, -30000, -32768]);
      } else {
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
