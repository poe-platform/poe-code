import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: RMS accumulation leaves a positive residual after the
// last nonzero sample, but removes the earlier isolated zero exactly.
const samples = [0, 0.244140629, 0, 0.244140633, -0.244140615, 0, 0];
const trimmed = [samples[0]!, samples[1]!, samples[3]!, samples[4]!];
for (const [options, expected] of [
  ["", [...trimmed, 0, 0]],
  [":stop_threshold=0.000001", trimmed],
  [":detection=peak", trimmed]
] as const) for (const graph of [false, true]) {
  it(`matches native double-precision trailing silence${options} (graph=${graph})`, async () => {
    const input = Buffer.alloc(samples.length * 8);
    samples.forEach((sample, i) => input.writeDoubleLE(sample, i * 8));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const filter = `silenceremove=window=0:stop_periods=-1${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_f64le", "-f", "f64le", "/out.raw"],
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
    const output = volume.readFileSync("/out.raw") as Buffer;
    const expectedBytes = Buffer.alloc(expected.length * 8);
    expected.forEach((sample, i) => expectedBytes.writeDoubleLE(sample, i * 8));
    assert.deepEqual(output, expectedBytes);
  });
}
