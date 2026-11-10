import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0x12345671, 0x23456783, -0x34567897, 0x42345679, -0x1234567f, 0x78123479, 0x60000001];

for (const format of ["s16le", "s32le", "f32le", "f64le"] as const) {
  const bytesPerSample = format === "s16le" ? 2 : format === "f64le" ? 8 : 4;
  for (const [filter, offsets] of [
    ["anull", [0]],
    ["adelay=0", [0]],
    ["adelay=2S", [2]],
    ["adelay=0S|2S", [0, 2]],
    ["adelay=0S|2S:enable=0", [0, 0]]
  ] as const) {
    for (const graph of [false, true]) {
      it(`${filter} preserves ${format} sample bytes (${graph ? "graph" : "simple"})`, async () => {
        const frameBytes = bytesPerSample * offsets.length;
        const input = Buffer.alloc(samples.length * frameBytes);
        for (const [i, sample] of samples.entries()) {
          for (let channel = 0; channel < offsets.length; channel++) {
            const offset = i * frameBytes + channel * bytesPerSample;
            const value = channel === 0 ? sample : -sample;
            if (format === "s16le") input.writeInt16LE(value >> 16, offset);
            else if (format === "s32le") input.writeInt32LE(value, offset);
            else if (format === "f32le") input.writeFloatLE(value / 2 ** 31, offset);
            else input.writeDoubleLE(value / 2 ** 31, offset);
          }
        }
        const padding = filter.includes("2S") ? 2 : 0;
        const expected = Buffer.alloc((samples.length + padding) * frameBytes);
        for (let i = 0; i < samples.length; i++) {
          for (const [channel, delay] of offsets.entries()) {
            const source = i * frameBytes + channel * bytesPerSample;
            input.copy(expected, (i + delay) * frameBytes + channel * bytesPerSample, source, source + bytesPerSample);
          }
        }
        const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", format, "-ar", "1000", "-ac", String(offsets.length), "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", format, "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(fs.readFileSync("/out.raw"), expected);
      });
    }
  }
}
