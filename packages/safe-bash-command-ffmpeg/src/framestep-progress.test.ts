import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Final rawvideo progress from FFmpeg 7.0.2-static, with four input frames at 4 fps.
for (const [filter, mode, ids, microseconds, time, graphMicroseconds = microseconds, graphTime = time] of [
  ["framestep=2", "passthrough", [1, 3], "500000", "00:00:00.500000"],
  ["framestep=2", "vfr", [1, 3], "500000", "00:00:00.500000"],
  ["framestep=2", undefined, [1, 3], "1000000", "00:00:01.000000"],
  ["trim=start_frame=1,framestep=2", undefined, [2, 4], "1500000", "00:00:01.500000", "1000000", "00:00:01.000000"],
  ["trim=start_frame=1,framestep=2", "passthrough", [2, 4], "1000000", "00:00:01.000000"],
  ["trim=start_frame=1,framestep=2", "vfr", [2, 4], "1000000", "00:00:01.000000"],
  ["framestep=3", "passthrough", [1, 4], "750000", "00:00:00.750000"],
  ["framestep=3", undefined, [1, 4], "1500000", "00:00:01.500000"],
  ["framestep=2,framestep=2", "passthrough", [1], "0", "00:00:00.000000"],
  ["framestep=2,fps=4", "passthrough", [1, 1, 3, 3], "1000000", "00:00:01.000000"],
  ["framestep=2,fps=8", "passthrough", [1, 1, 1, 1, 3, 3, 3, 3], "1000000", "00:00:01.000000"],
  [undefined, "passthrough", [1, 2, 3, 4], "1000000", "00:00:01.000000"]
] as const) {
  for (const graph of [false, true]) {
    it(`reports rawvideo progress for ${filter ?? "no filter"}, ${mode ?? "default"} sync (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from([1, 2, 3, 4].flatMap(id => [id, id, id, id]));
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-progress", "pipe:1", "-f", "rawvideo", "-framerate", "4",
          "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
          ...(filter === undefined ? [] : graph
            ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
          ...(mode === undefined ? [] : ["-fps_mode", mode]), "-f", "rawvideo", "/out.bin"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(volume.readFileSync("/out.bin"), Buffer.from(ids.flatMap(id => [id, id, id, id])));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      const records = Object.fromEntries(stdout.trim().split("\n").map(line => line.split("=")));
      assert.equal(records.frame, String(ids.length));
      assert.equal(records.total_size, String(ids.length * 4));
      assert.equal(records.progress, "end");
      assert.equal(records.out_time_us, graph ? graphMicroseconds : microseconds);
      assert.equal(records.out_time_ms, graph ? graphMicroseconds : microseconds);
      assert.equal(records.out_time, graph ? graphTime : time);
    });
  }
}
