import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Timestamp text and complete raw output verified with FFmpeg 7.0.2-static.
for (const [rate, filter, pts, time, duration, durationTime] of [
  ["4", "showinfo", "0", "0", "1", "0.25"],
  ["4", "settb=1/9,setpts=1,showinfo", "1", "0.111111", "0", "0"],
  ["4", "settb=1/9,setpts=10,showinfo", "10", "1.111111", "0", "0"],
  ["4", "settb=1/9,setpts=100,showinfo", "100", "11.111111", "0", "0"],
  ["4", "settb=1/9,setpts=-10,showinfo", "-10", "-1.111111", "0", "0"],
  ["4", "settb=1/9,setpts=17,showinfo", "17", "1.888889", "0", "0"],
  ["9/10", "showinfo", "0", "0", "1", "1.111111"]
] as const) {
  for (const graph of [false, true]) {
    it(`formats showinfo timestamps for ${filter} at ${rate} fps (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("11589fe6", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "2x2", "-framerate", rate, "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), input);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      const rows = stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
      assert.equal(rows.length, 1, stderr);
      assert.ok(rows[0]!.startsWith(`[showinfo] n:0 pts:${pts} pts_time:${time} duration:${duration} duration_time:${durationTime} `), stderr);
    });
  }
}
