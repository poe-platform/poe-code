import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const [options, valid] of [
  ...["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=0:extra_hw_frames=-1", "threads=1+1:extra_hw_frames=2-1",
    "threads=default:extra_hw_frames=min", "threads=max:extra_hw_frames=max",
    "threads=1.5", "thread_type=none", "thread_type=all-slice", "thread_type=+slice",
    "thread_type=-slice", "thread_type=4294967295", "threads=1:"]
    .map(options => [options, true] as const),
  ...["1", "unknown=1", "threads=1:unknown=1", "threads=-1", "threads=2147483648",
    "threads=", "threads=bogus", "thread_type=bogus", "thread_type=",
    "thread_type=slice+", "thread_type=0.5", "thread_type=4294967296",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=bogus",
    "enable=1", "threads=1:1"]
    .map(options => [options, false] as const)
] as const) {
  it(`separatefields=${options} preserves fields and timestamps or rejects invalid options`, async () => {
    const fs = createMemoryFileSystem();
    const input = Buffer.from("0d141b22", "hex");
    await fs.writeFile("/in.raw", input);
    await fs.writeFile("/out.raw", Buffer.from("KEEP"));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "info", "-y", "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", "2x2", "-r", "2", "-i", "in.raw", "-vf", `separatefields=${options},showinfo`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    if (valid) {
      assert.equal(result.exitCode, 0, stderr);
      const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
      assert.equal(frames.length, 2, stderr);
      for (const [index, frame] of frames.entries()) {
        assert.ok(frame.includes("s:2x1"), stderr);
        assert.ok(frame.includes(`pts:${index} pts_time:${index / 4} `), stderr);
      }
      assert.equal(Buffer.from(await fs.readFile("/out.raw")).toString("hex"), "1b220d14");
    } else {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("separatefields:"), stderr);
      assert.equal(Buffer.from(await fs.readFile("/out.raw")).toString(), "KEEP");
    }
    assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
  });
}
