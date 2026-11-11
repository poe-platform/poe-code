import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Pixels, timestamps and durations captured from native FFmpeg 7.0.2-static.
for (const [filter, pixels, pts, times, duration, durationTime] of [
  ["null", "0d141b222930373e", [0, 1], [0, 0.5], 1, 0.5],
  ["setpts=PTS", "0d141b222930373e", [0, 1], [0, 0.5], 0, 0],
  ["setpts=2*PTS", "0d141b222930373e", [0, 2], [0, 1], 0, 0],
  ["setpts=PTS,separatefields", "1b220d14373e2930", [0, 1, 2, 3], [0, 0.25, 0.5, 0.75], 0, 0],
  ["setpts=2*PTS,separatefields", "1b220d14373e2930", [0, 2, 4, 6], [0, 0.5, 1, 1.5], 0, 0],
  ["setpts=PTS,fps=2", "0d141b222930373e", [0, 1], [0, 0.5], 1, 0.5]
] as const) {
  for (const graph of [false, true]) {
    it(`matches FFmpeg 7 frame durations after ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("0d141b222930373e", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      let stderr = "";
      const chain = `${filter},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${chain}[out]`, "-map", "[out]"] : ["-vf", chain]),
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
      assert.equal(Buffer.concat(output).toString("hex"), pixels);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      const rows = stderr.trim().split("\n").filter(line => line.startsWith("[showinfo] n:"));
      assert.equal(rows.length, pts.length, stderr);
      for (const [n, row] of rows.entries()) {
        assert.ok(row.startsWith(`[showinfo] n:${n} pts:${pts[n]} pts_time:${times[n]} duration:${duration} duration_time:${durationTime} `), row);
      }
    });
  }
}
