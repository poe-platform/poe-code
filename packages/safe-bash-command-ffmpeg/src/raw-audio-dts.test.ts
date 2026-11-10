import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reports invalid muxer DTS without dropping PCM or failing.
for (const graph of [false, true]) {
  for (const [expression, level, expected] of [
    ["2", "error", "[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 2 >= 2\n    Last message repeated 2 times\n"],
    ["N", "error", ""],
    ["0", "error", ""],
    ["NAN", "error", ""],
    ["-2", "error", "[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: -2 >= -2\n    Last message repeated 2 times\n"],
    ["2+floor(N/4)*2", "error", "[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 2 >= 2\n[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 4 >= 4\n"],
    ["10-N", "error", "[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 10 >= 8\n[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 10 >= 6\n[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 10 >= 4\n"],
    ["2", "fatal", ""],
    ["2", "quiet", ""],
    ["2", "16", "[s16le] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 2 >= 2\n    Last message repeated 2 times\n"]
  ]) {
    it(`preserves raw PCM and reports asetpts=${expression} at ${level} (graph ${graph})`, async () => {
      const input = Buffer.alloc(32);
      for (let i = 0; i < 8; i++) {
        input.writeInt16LE(i + 1, i * 4);
        input.writeInt16LE(-i - 1, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const filter = `asetnsamples=n=2:p=0,asetpts=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", level, "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), input);
      assert.equal(stderr, expected);
    });
  }
}
