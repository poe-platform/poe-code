import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Native FFmpeg 7.0.2 PCM16 output, including the resampler's startup delay.
const waveform = [1000, 1336, 2000, 2536, 3000, 3540, 4000, 4390, 5000, 5691,
  6000, 6202, 7000, 7958, 8000, 7759, 9000, 10925, 10000, 5093, 0, -1386,
  0, 732, 0, -461, 0, 310, 0, -213, 0, 146, 0, -99, 0, 65, 0, -42,
  0, 25, 0, -15, 0, 8, 0, -4, 0, 1];
for (const graph of [false, true]) {
  for (const [padding, rate, options, retained] of [
    ["", 2000, ["-t", "0.014"], waveform.slice(0, 28)],
    ["", 2000, ["-frames:a", "4"], waveform],
    [":pad_len=64", 2000, ["-t", "0.014"], waveform.slice(0, 28)],
    ["", 1000, ["-t", "0.014"], [...samples, 0, 0, 0, 0]]
  ] as const) {
    for (const resample of [String(rate), `${rate}:osf=fltp`, `out_sample_fmt=fltp:osr=${rate}`]) {
      const filter = `asetnsamples=n=3:p=0,apad=packet_size=2${padding},aresample=${resample}`;
      it(`${filter} with ${options.join(" ")} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...options, "-f", "s16le", "/out.raw"],
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
        const expected = Buffer.alloc(retained.length * 2);
        retained.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      });
    }
  }
}
