import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reports one second for these four frames, regardless of muxer offset.
for (const offset of [undefined, "1", "-1"]) {
  it(`excludes ${offset ?? "omitted"} output timestamp offset from rawvideo progress`, async () => {
    const input = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-progress", "pipe:1", "-f", "rawvideo", "-framerate", "4",
        "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
        ...(offset === undefined ? [] : ["-output_ts_offset", offset]), "-f", "rawvideo", "/out.bin"],
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
    const records = Object.fromEntries(stdout.trim().split("\n").map(line => line.split("=")));
    assert.equal(records.frame, "4");
    assert.equal(records.total_size, "16");
    assert.equal(records.progress, "end");
    assert.equal(records.out_time, "00:00:01.000000");
    assert.equal(records.out_time_us, "1000000");
    assert.equal(records.out_time_ms, "1000000");
  });
}
