import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [format, bytes] of [["s16le", 2], ["s32le", 4], ["f32le", 4], ["f64le", 8]] as const) {
  for (const channels of [1, 2]) {
    for (const padding of [0, 2]) {
      for (const graph of [false, true]) {
        it(`apad preserves ${format} bytes with ${padding} silent samples (${channels}ch, ${graph ? "graph" : "simple"})`, async () => {
          const samples = [0x12345671, 0x23456783, -0x34567897, 0x42345679, -0x1234567f, 0x78123479, 0x60000001];
          const input = Buffer.alloc(samples.length * channels * bytes);
          for (let frame = 0; frame < samples.length; frame++) {
            for (let channel = 0; channel < channels; channel++) {
              const sample = samples[(frame + channel) % samples.length]!;
              const offset = (frame * channels + channel) * bytes;
              if (format === "s16le") input.writeInt16LE(sample >> 16, offset);
              else if (format === "s32le") input.writeInt32LE(sample, offset);
              else if (format === "f32le") input.writeFloatLE(sample / 2 ** 31, offset);
              else input.writeDoubleLE(sample / 2 ** 31, offset);
            }
          }
          const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
          const filter = `apad=pad_len=${padding}`;
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-f", format, "-ar", "1000", "-ac", String(channels), "-i", "/in.raw",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", format, "/out.raw"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([input, Buffer.alloc(padding * channels * bytes)]));
        });
      }
    }
  }
}
