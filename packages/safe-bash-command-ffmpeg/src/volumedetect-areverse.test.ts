import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, samples, measured] of [
  ["volumedetect", 512, 512],
  ["volumedetect,areverse", 352, 2400],
  ["areverse,volumedetect", 352, 352],
  ["volumedetect,anull,areverse@reverse", 352, 2400]
] as const) {
  it(`volumedetect respects reversal buffering: ${filter}`, async () => {
    const channel = new Float64Array(2400);
    channel.fill(0.5, 2000);
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [channel] }));
    let stderr = "";
    const chunks: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af", filter,
        "-frames:a", "1", "-f", "f32le", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const expected = Buffer.alloc(samples * 4);
    for (let i = 0; i < samples; i++) {
      if (filter.includes("areverse") ? i < 400 : i >= 2000) expected.writeFloatLE(0.5, i * 4);
    }
    assert.deepEqual(Buffer.concat(chunks), expected);
    assert.equal(stderr, measured === 2400
      ? "n_samples: 0\nn_samples: 2400\nmean_volume: -13.8 dB\nmax_volume: -6.0 dB\nhistogram_6db: 400\n"
      : measured === 352
        ? "n_samples: 0\nn_samples: 352\nmean_volume: -6.0 dB\nmax_volume: -6.0 dB\n"
        : `n_samples: 0\nn_samples: ${measured}\nmean_volume: -91.0 dB\nmax_volume: -91.0 dB\n${measured >= 1000 ? `histogram_91db: ${measured}\n` : ""}`);
  });
}
