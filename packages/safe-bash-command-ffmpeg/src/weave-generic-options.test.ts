import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const name of ["weave", "doubleweave"]) for (const [options, valid] of [
  ...["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=0:extra_hw_frames=-1", "threads=1+1:extra_hw_frames=2-1",
    "threads=default:extra_hw_frames=min", "threads=max:extra_hw_frames=max",
    "threads=1.5", "thread_type=none", "thread_type=all-slice", "thread_type=+slice",
    "thread_type=-slice", "thread_type=4294967295", "threads=1:"]
    .map(options => [options, true] as const),
  ...["unknown=1", "threads=1:unknown=1", "threads=-1", "threads=2147483648",
    "threads=", "threads=bogus", "thread_type=bogus", "thread_type=",
    "thread_type=slice+", "thread_type=0.5", "thread_type=4294967296",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=bogus",
    "enable=1", "threads=1:bottom"]
    .map(options => [options, false] as const)
] as const) {
  for (const [type, expected] of [["", "0d14"], ["first_field=t", "0d14"], ["bottom", "140d"]] as const) {
    it(`${name} ${[type, options].filter(Boolean).join(":")} preserves row selection and option validation`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.from("0d14", "hex");
      await fs.writeFile("/in.raw", input);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const filter = `${name}=${[type, options].filter(Boolean).join(":")},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "1x1", "-r", "2", "-i", "in.raw", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
        assert.equal(frames.length, 1, stderr);
        assert.ok(frames[0]!.includes("s:1x2"), stderr);
        assert.ok(frames[0]!.includes("pts_time:0"), stderr);
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes(`${name}:`), stderr);
      }
      assert.equal(Buffer.concat(stdout).toString("hex"), valid ? expected : "");
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
    });
  }
}
