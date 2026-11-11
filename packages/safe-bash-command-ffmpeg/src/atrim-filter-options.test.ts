import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [complex, trim] of [
  [false, "start_sample=5"], [true, "start_sample=5"],
  [false, "end_sample=5"], [true, "end_sample=5"]
] as const) {
  for (const [options, exitCode] of [
    ["", 0],
    [":threads=1", 0],
    [":threads=min", 0],
    [":threads=max/max", 0],
    [":threads=max/2147483647", 0],
    [":threads=PI", 0],
    [":threads=E", 0],
    [":threads=PHI", 0],
    [":threads=3", 0],
    [":threads=default", 0],
    [":extra_hw_frames=min", 0],
    [":extra_hw_frames=max/max", 0],
    [":extra_hw_frames=max/2147483647", 0],
    [":extra_hw_frames=PI", 0],
    [":extra_hw_frames=E", 0],
    [":extra_hw_frames=PHI", 0],
    [":extra_hw_frames=default", 0],
    [":thread_type=slice", 0],
    [":thread_type=default", 0],
    [":thread_type=max/max", 0],
    [":thread_type=max/2147483647", 0],
    [":thread_type=default-slice", 0],
    [":thread_type=-slice", 0],
    [":thread_type=none", 0],
    [":thread_type=all", 0],
    [":thread_type=+slice", 0],
    [":thread_type=slice-slice", 0],
    [":thread_type=all-slice", 0],
    [":thread_type=none+slice", 0],
    [":thread_type=-1", 0],
    [":thread_type=4294967295", 0],
    [":thread_type=4294967296", 222],
    [":thread_type=1.5", 222],
    [":thread_type=slice+bogus", 234],
    [":thread_type=", 234],
    [":thread_type=slice+", 234],
    [":extra_hw_frames=1", 0],
    [":threads=0:thread_type=0:extra_hw_frames=-1", 0],
    [":threads=1:thread_type=slice:extra_hw_frames=1", 0],
    [":threads=-1", 222],
    [":threads=2147483648", 222],
    [":threads=", 234],
    [":threads=0/0", 234],
    [":thread_type=bogus", 234],
    [":extra_hw_frames=-2", 222]
  ] as const) {
    for (const outputExists of [false, true]) {
      it(`atrim=${trim}${options} (${complex ? "complex" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
        const input = Buffer.alloc(32);
        for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
        const existing = Buffer.from("existing output");
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": existing } : {}) });
        let stderr = "";
        const filter = `atrim=${trim}${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(result.exitCode, exitCode, stderr);
        if (exitCode === 0) assert.deepEqual(volume.readFileSync("/out.raw"), trim === "start_sample=5" ? input.subarray(10) : input.subarray(0, 10));
        else {
          assert.ok(stderr.includes("atrim:"), stderr);
          assert.equal(volume.existsSync("/out.raw"), outputExists);
          if (outputExists) assert.deepEqual(volume.readFileSync("/out.raw"), existing);
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
