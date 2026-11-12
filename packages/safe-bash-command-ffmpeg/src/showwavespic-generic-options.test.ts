import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(32);
[32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128]
  .forEach((sample, index) => input.writeInt16LE(sample, index * 2));
// Native FFmpeg 7.0.2 RGBA output for this stereo PCM fixture.
const picture = Buffer.from("00000000000000007f3f00fe7f00007f7f00007f000000000000000000000000", "hex");

for (const [valid, options] of [
  [true, ["", ":threads=2", ":extra_hw_frames=0", ":thread_type=slice",
    ":threads=0:extra_hw_frames=-1", ":threads=default:extra_hw_frames=default:thread_type=default",
    ":threads=1+1:extra_hw_frames=2+2:thread_type=+slice-slice",
    ":threads=2147483647:extra_hw_frames=2147483647",
    ":threads=1:threads=2:extra_hw_frames=1:extra_hw_frames=0"]],
  [false, [":threads=-1", ":threads=2147483648", ":threads=bogus", ":threads=",
    ":extra_hw_frames=-2", ":extra_hw_frames=2147483648", ":extra_hw_frames=bogus",
    ":extra_hw_frames=", ":thread_type=bogus", ":thread_type=0.5",
    ":threads=bogus:threads=2", ":extra_hw_frames=bogus:extra_hw_frames=0",
    ":threads=2:unknown=1"]]
] as const) {
  for (const option of options) {
    for (const target of ["-", "/out.raw"]) {
      it(`showwavespic ${valid ? "preserves pixels" : "rejects invalid options"}: ${option || "defaults"} to ${target}`, async () => {
        const fs = createMemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        await fs.writeFile("/out.raw", Buffer.from("KEEP"));
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            "-filter_complex", `showwavespic=s=2x4${option}`, "-frames:v", "1",
            "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", target],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout.push(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.deepEqual(target === "-" ? Buffer.concat(stdout) : Buffer.from(await fs.readFile(target)), picture);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("showwavespic:"), stderr);
          assert.equal(Buffer.concat(stdout).length, 0);
        }
        if (!valid || target === "-") assert.equal(Buffer.from(await fs.readFile("/out.raw")).toString(), "KEEP");
      });
    }
  }
}
