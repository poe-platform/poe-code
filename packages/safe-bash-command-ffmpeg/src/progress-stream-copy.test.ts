import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: four 2x2 gray packets at 4 fps end at one second.
for (const copy of [true, false]) {
  it(`reports rawvideo ${copy ? "packet" : "encoded frame"} progress`, async () => {
    const input = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-progress", "pipe:1", "-f", "rawvideo",
        "-framerate", "4", "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
        ...(copy ? ["-c:v", "copy"] : []), "-f", "rawvideo", "/out.bin"],
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
    assert.equal(records.total_size, "16");
    assert.equal(records.out_time_us, "1000000");
    assert.equal(records.out_time_ms, "1000000");
    assert.equal(records.out_time, "00:00:01.000000");
    assert.equal(records.frame, copy ? undefined : "4");
    assert.equal(records.stream_0_0_q, copy ? undefined : "-0.0");
    if (copy) assert.equal(records.fps, undefined);
    assert.equal(records.progress, "end");
  });
}
