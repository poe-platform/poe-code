import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [valid, options] of [
  [true, ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=default:extra_hw_frames=min", "threads=1+1:extra_hw_frames=2-1",
    "threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647",
    "thread_type=+slice", "thread_type=-slice", "thread_type=all-slice",
    "threads=1:threads=2"]],
  [false, ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296", "thread_type=slice+",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=", "extra_hw_frames=NaN",
    "threads=-1:threads=1", "thread_type=bogus:thread_type=slice",
    "extra_hw_frames=-2:extra_hw_frames=1", "threads=1:unknown=1"]]
] as const) {
  for (const option of options) {
    for (const output of ["pipe:1", "/out.raw"]) {
      it(`gradfun generic options ${option || "control"} to ${output}`, async () => {
        const input = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
          50 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 128)));
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo",
            "-pixel_format", "gray", "-video_size", "32x32", "-framerate", "4", "-i", "/in.raw",
            "-vf", `gradfun=strength=5:radius=4${option ? `:${option}` : ""}`,
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", output],
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
          const bytes = output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output) as Buffer;
          assert.equal(bytes.length, 1024);
          // Complete FFmpeg 7.0.2 output, including 724 changed input bytes.
          assert.equal(createHash("sha256").update(bytes).digest("hex"),
            "f021f8f8032267309cd2b854e7c8b457db230bb5f9d95d11431579039b46c3d0");
        } else {
          assert.notEqual(result.exitCode, 0, option);
          assert.ok(stderr.includes("gradfun"), stderr);
          assert.equal(Buffer.concat(stdout).length, 0);
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
