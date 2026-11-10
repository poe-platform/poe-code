import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Error statuses and frame bytes from FFmpeg 7.0.2 on Linux.
for (const [filter, status] of [
  ["reverse=foo", 234],
  ["reverse@r=bad=1", 8],
  ["reverse=enable=0", 176],
  ["reverse=enable=1", 176],
  ["reverse", 0],
  ["reverse=", 0],
  ["reverse@r", 0],
  ["reverse@r=", 0],
  ["reverse=threads=2:thread_type=slice:extra_hw_frames=-1", 0],
  ["reverse=threads=-1", 222],
  ["reverse=threads=2147483648", 222],
  ["reverse=threads=bad", 234]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves status and destination (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const frames = [32, 52, 72, 92, 112, 132].map(value =>
        Buffer.concat([Buffer.alloc(4, value), Buffer.alloc(8, 128)]));
      const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
      await fs.writeFile("/in.y4m", input);
      await fs.writeFile("/o.raw", Buffer.from("KEEP"));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[rev]`, "-map", "[rev]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.deepEqual(Buffer.from(await fs.readFile("/o.raw")),
        status === 0 ? Buffer.concat([...frames].reverse()) : Buffer.from("KEEP"));
      assert.equal(result.exitCode, status, stderr);
      if (status !== 0) assert.ok(stderr.includes("reverse:"), stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.y4m")), input);
    });
  }
}
