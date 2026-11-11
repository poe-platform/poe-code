import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, frames, samples, measured] of [
  ["volumedetect", "1", 512, 512],
  ["volumedetect,asetnsamples=128:p=0", "3", 384, 512],
  ["volumedetect,asetnsamples=128:p=0:enable=0", "3", 1024, 1024],
  ["volumedetect,asetnsamples=128:p=0:enable=1", "3", 384, 512],
  ["volumedetect,asetnsamples", "1", 1024, 1024],
  ["volumedetect,asetnsamples=1024:p=0", "1", 1024, 1024],
  ["volumedetect,asetnsamples=128:p=0", "5", 640, 1024],
  ["volumedetect,asetnsamples@frames=nb_out_samples=700:pad=0", "2", 1400, 1536],
  ["asetnsamples=256:0,volumedetect,asetnsamples=1024:p=0", "1", 1024, 1024],
  ["volumedetect,asetnsamples=1024:p=0", "4", 2400, 2400],
  ["volumedetect,atrim=end_sample=10", undefined, 10, 1024],
  ["volumedetect,anull,atrim=end_sample=10", undefined, 10, 1024],
  ["volumedetect,acopy,atrim=end_sample=10", undefined, 10, 1024],
  ["volumedetect,volume=1,atrim=end_sample=10", undefined, 10, 1024],
  ["volumedetect,anull,volume@pass=1,anull,atrim@end=end_sample=10", undefined, 10, 1024],
  ["volumedetect,anull,atrim=end_sample=512", undefined, 512, 1024],
  ["volumedetect,volume=1,atrim=end_sample=10", "1", 10, 512],
  ["asetnsamples=256:0,volumedetect,anull,atrim=end_sample=10", undefined, 10, 512],
  ["volumedetect", undefined, 2400, 2400],
  ["volumedetect,anull", undefined, 2400, 2400],
  ["volumedetect,volume=1", undefined, 2400, 2400],
  ["volumedetect,anull,asetpts=PTS-2400,atrim=end=0.00125", undefined, 2400, 2400],
  ["atrim=end_sample=10,volumedetect", undefined, 10, 10],
  ["asetnsamples=256:0,volumedetect,atrim=end_sample=10", undefined, 10, 512],
  ["volumedetect,atrim=end_sample=512", undefined, 512, 1024]
] as const) {
  it(`volumedetect measures demanded frames: ${filter}, limit ${frames}`, async () => {
    const channel = new Float64Array(2400);
    channel.fill(0.5, 2000);
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [channel] }));
    let stderr = "";
    const chunks: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af", filter,
        ...(frames === undefined ? [] : ["-frames:a", frames]), "-f", "f32le", "-"],
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
    for (let i = 2000; i < samples; i++) expected.writeFloatLE(0.5, i * 4);
    assert.deepEqual(Buffer.concat(chunks), expected);
    assert.equal(stderr, measured === 2400
      ? "n_samples: 2400\nmean_volume: -13.8 dB\nmax_volume: -6.0 dB\nhistogram_6db: 400\n"
      : `n_samples: ${measured}\nmean_volume: -91.0 dB\nmax_volume: -91.0 dB\n${measured >= 1000 ? `histogram_91db: ${measured}\n` : ""}`);
  });
}
