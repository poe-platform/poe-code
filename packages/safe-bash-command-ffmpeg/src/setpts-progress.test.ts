import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Final rawvideo progress records from FFmpeg 7.0.2-static at four frames per second.
for (const [filter, microseconds, time] of [
  [undefined, "1000000", "00:00:01.000000"],
  ["setpts=PTS", "750000", "00:00:00.750000"],
  ["setpts=2*PTS", "1500000", "00:00:01.500000"],
  ["setpts=PTS,fps=4", "1000000", "00:00:01.000000"]
] as const) {
  it(`reports native rawvideo progress after ${filter ?? "no filter"}`, async () => {
    const input = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-progress", "pipe:1", "-f", "rawvideo",
        "-framerate", "4", "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
        ...(filter === undefined ? [] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-f", "rawvideo", "/out.bin"],
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
    assert.deepEqual(volume.readFileSync("/out.bin"), input);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
    const records = Object.fromEntries(stdout.trim().split("\n").map(line => line.split("=")));
    assert.equal(records.progress, "end");
    assert.equal(records.frame, "4");
    assert.equal(records.out_time_us, microseconds);
    assert.equal(records.out_time_ms, microseconds);
    assert.equal(records.out_time, time);
  });
}
