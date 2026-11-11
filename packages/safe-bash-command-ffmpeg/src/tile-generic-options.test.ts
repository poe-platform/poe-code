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
  [":threads=-1", false],
  [":threads=2147483648", false],
  [":threads=", false],
  [":thread_type=bogus", false],
  [":thread_type=0.5", false],
  [":extra_hw_frames=-2", false],
  [":extra_hw_frames=2147483648", false],
  [":unknown=1", false],
  [":2x2", false]
] as const) {
  for (const layout of ["2x2", "layout=2x2"]) {
    it(`handles tile=${layout}${options} without changing pixels`, async () => {
      const input = Buffer.from([10, 11, 30, 31, 60, 61, 100, 101, 150, 151]);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x1", "-r", "4", "-i", "/in.raw", "-vf", `tile=${layout}${options}`,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.deepEqual(Buffer.concat(stdout), Buffer.from("0a0b1e1f3c3d64659697000000000000", "hex"));
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("tile:"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      assert.deepEqual(volume.readdirSync("/"), ["in.raw"]);
    });
  }
}
