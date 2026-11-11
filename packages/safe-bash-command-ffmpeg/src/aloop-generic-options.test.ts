import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: generic options leave the repeated mono PCM16 samples unchanged.
for (const [options, status] of [
  ["", 0], [":threads=1", 0], [":thread_type=slice", 0], [":extra_hw_frames=1", 0],
  [":threads=1:thread_type=slice:extra_hw_frames=1", 0],
  [":threads=0:thread_type=none:extra_hw_frames=-1", 0],
  [":threads=default:thread_type=all-slice:extra_hw_frames=min", 0],
  [":threads=1+1:thread_type=+slice:extra_hw_frames=2-1", 0],
  [":threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647", 0],
  [":threads=-1", 222], [":threads=2147483648", 222],
  [":threads=bad", 234], [":threads=", 234],
  [":thread_type=bad", 234], [":thread_type=slice+", 234],
  [":thread_type=0.5", 222], [":thread_type=4294967296", 222],
  [":extra_hw_frames=-2", 222], [":extra_hw_frames=2147483648", 222],
  [":extra_hw_frames=bad", 234]
] as const) {
  for (const complex of [false, true]) {
    it(`aloop generic options (${complex ? "graph" : "simple"}): ${options || "control"}`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `aloop=1:3:0${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(output.length, 28);
        assert.deepEqual(Array.from({ length: 14 }, (_, i) => output.readInt16LE(i * 2)),
          [1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      } else {
        assert.ok(stderr.includes("aloop:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
