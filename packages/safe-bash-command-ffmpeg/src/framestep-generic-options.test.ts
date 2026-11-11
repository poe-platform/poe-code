import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Four 2x2 gray frames at 6 fps: FFmpeg keeps bytes 0..3 and 8..11, at PTS 0 and 2.
for (const [options, status] of [
  ...["threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=0", "threads=1.5", "threads=1+1", "threads=default", "threads=max", "threads=PI",
    "thread_type=none", "thread_type=all-slice", "thread_type=+slice", "thread_type=-slice",
    "thread_type=0xffffffff", "thread_type=slice+slice", "thread_type=slice--slice",
    "extra_hw_frames=-1", "extra_hw_frames=default", "extra_hw_frames=min", "extra_hw_frames=0.5",
    "threads=1:thread_type=slice:extra_hw_frames=1", "threads=1:"]
    .map(options => [options, 0] as const),
  ...["threads=-1", "threads=2147483648", "thread_type=0.5", "thread_type=4294967296",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648"]
    .map(options => [options, 222] as const),
  ...["unknown=1", "threads=1:unknown=1", "threads=", "threads=nope",
    "thread_type=", "thread_type=bogus", "thread_type=slice+bogus", "thread_type=slice+",
    "extra_hw_frames=", "extra_hw_frames=nope", "threads=1:2"]
    .map(options => [options, 234] as const)
] as const) {
  for (const graph of [false, true]) {
    it(`framestep ${options} preserves status, frames and PTS (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.from(Array.from({ length: 16 }, (_, i) => 13 + 7 * i));
      await fs.writeFile("/in.raw", input);
      const output: Uint8Array[] = [];
      let stderr = "";
      const filter = `framestep${graph ? "@step" : ""}=${graph ? "2" : "step=2"}:${options},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x2", "-r", "6", "-i", "in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(chunk) { output.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, status, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), status === 0 ? "0d141b22454c535a" : "");
      const pts = stderr.split("\n").filter(line => line.includes(" pts:"))
        .map(line => Number(line.split(" pts:")[1]!.trimStart().split(" ")[0]));
      assert.deepEqual(pts, status === 0 ? [0, 2] : []);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
    });
  }
}
