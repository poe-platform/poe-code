import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, valid] of [
  ["", true],
  [":threads=1", true],
  [":thread_type=slice", true],
  [":extra_hw_frames=1", true],
  [":threads=1:thread_type=slice:extra_hw_frames=1", true],
  [":threads=0:thread_type=0:extra_hw_frames=-1", true],
  [":threads=1+1", true],
  [":threads=-1", false],
  [":threads=2147483648", false],
  [":threads=", false],
  [":thread_type=bogus", false],
  [":thread_type=0.5", false],
  [":extra_hw_frames=-2", false],
  [":extra_hw_frames=2147483648", false],
  [":unknown=1", false]
] as const) {
  for (const complex of [false, true]) {
    it(`handles channelmap generic options (${complex ? "graph" : "simple"}): ${options || "control"}`, async () => {
      const input = Buffer.from("64009cffc80038ff", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `channelmap=1|0${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("9cff640038ffc800", "hex"));
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("channelmap:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
