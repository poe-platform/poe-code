import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: progress includes signed asetpts offsets without changing PCM.
for (const graph of [false, true]) {
  for (const [filter, microseconds, time] of [
    ["anull", "1000", "00:00:00.001000"],
    ["asetpts=PTS+1/TB", "1001000", "00:00:01.001000"],
    ["asetpts=PTS-1/TB", "-999000", "-00:00:00.999000"]
  ]) {
    it(`reports ${filter} progress with graph=${graph} and preserves PCM`, async () => {
      const input = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-progress", "pipe:1", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.bin"],
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
      assert.deepEqual(volume.readFileSync("/out.bin"), input);
      const records = Object.fromEntries(stdout.trim().split("\n").map(line => line.split("=")));
      assert.equal(records.out_time_us, microseconds);
      assert.equal(records.out_time_ms, microseconds);
      assert.equal(records.out_time, time);
      assert.equal(records.progress, "end");
      assert.equal(stderr, "");
    });
  }
}
