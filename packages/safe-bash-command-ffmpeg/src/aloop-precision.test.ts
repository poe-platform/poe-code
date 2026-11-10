import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static: ten input samples, a four-sample loop, and a 12 ms output limit.
for (const [format, bytes] of [["s16le", 2], ["s32le", 4], ["f32le", 4], ["f64le", 8]] as const) {
  for (const channels of [1, 2]) {
    for (const graph of [false, true]) {
      for (const [filter, order] of [
        ["anull", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
        ["aloop=loop=0:size=4", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
        ["aloop=loop=1:size=4", [0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7]],
        ["aloop=loop=-1:size=4", [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]]
      ] as const) {
        it(`${filter} preserves ${format} PCM (${channels}ch, ${graph ? "graph" : "simple"})`, async () => {
          const input = Buffer.alloc(10 * channels * bytes);
          for (let frame = 0; frame < 10; frame++) {
            for (let channel = 0; channel < channels; channel++) {
              const sign = channel === 0 ? 1 : -1;
              const sample = sign * (0x12345670 + frame);
              const offset = (frame * channels + channel) * bytes;
              if (format === "s16le") input.writeInt16LE(sign * (frame + 1) * 1000, offset);
              else if (format === "s32le") input.writeInt32LE(sample, offset);
              else if (format === "f32le") input.writeFloatLE(sample / 2 ** 31, offset);
              else input.writeDoubleLE(sample / 2 ** 31, offset);
            }
          }
          const volume = Volume.fromJSON({ "/in.raw": input });
          const output: Uint8Array[] = [];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-nostats", "-v", "info", "-f", format, "-ar", "1000", "-ac", String(channels), "-i", "/in.raw",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-t", "0.012", "-f", format, "-"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { output.push(data); } },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(Buffer.concat(output), Buffer.concat(order.map(frame =>
            input.subarray(frame * channels * bytes, (frame + 1) * channels * bytes))));
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
        });
      }
    }
  }
}
