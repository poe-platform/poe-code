import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, status] of [
  ["", 0], [":threads=1", 0], [":thread_type=slice", 0], [":extra_hw_frames=1", 0],
  [":threads=1:thread_type=slice:extra_hw_frames=1", 0],
  [":threads=0:thread_type=0:extra_hw_frames=-1", 0],
  [":threads=2147483647:extra_hw_frames=2147483647", 0],
  [":threads=1+1:extra_hw_frames=2-1", 0],
  [":thread_type=+slice", 0], [":thread_type=-slice", 0],
  [":thread_type=4294967295", 0],
  [":threads=-1", 1], [":threads=2147483648", 1],
  [":extra_hw_frames=-2", 1], [":extra_hw_frames=2147483648", 1],
  [":threads=", 1], [":threads=0/0", 1],
  [":thread_type=bogus", 1], [":thread_type=", 1],
  [":thread_type=0.5", 1], [":thread_type=4294967296", 1],
  [":unknown=1", 1]
] as const) {
  for (const graph of [false, true]) {
    for (const outputExists of [false, true]) {
      it(`silenceremove generic options ${options || "control"} (${graph ? "graph" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
        const samples = [0, 0, 0, 0, 8000, 0, 0, 16000, 8000, 16000, -8000, 0, 0, 0, 0, 0, 0, -16000, 8000, 16000, 0, 0, 0, 0, 8000, -16000, 8000, 16000, 0, 0, 0, 0];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": "KEEP" } : {}) });
        const filter = `silenceremove=start_periods=1:window=0${options}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
          // Native FFmpeg 7.0.2 output for the same stereo input and options.
          assert.equal(output.toString("hex"),
            "401f00000000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000");
        } else {
          assert.ok(stderr.includes("silenceremove:"), stderr);
          assert.equal(volume.existsSync("/out.raw"), outputExists);
          if (outputExists) assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
