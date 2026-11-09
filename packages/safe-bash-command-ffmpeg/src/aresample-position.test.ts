import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, options: { graph?: boolean; rate?: number; length?: number; channels?: number } = {}) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: options.channels ?? 1 }, (_, c) =>
      new Float64Array(options.length ?? 1024).fill((c ? -6000 : 12000) / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxMemoryBytes: 16 * 1024 * 1024 } }).execute({
    args: ["-y", "-i", "/in.wav", ...(options.graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...(options.rate === undefined ? [] : ["-ar", String(options.rate)]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.wav") as Buffer };
}

for (const [filter, rate, length, prefix] of [
  ["aresample", 8000, 1024, [12000]],
  ["aresample=8000", 8000, 1024, [12000]],
  ["aresample=16000", 16000, 2048, [12000]],
  ["aresample=osr=16000", 16000, 2048, [12000]],
  ["aresample=out_sample_rate=16000", 16000, 2048, [12000]],
  ["aresample=sample_rate=16000", 16000, 2048, [12000]],
  ["aresample=0", 8000, 1024, [12000]],
  ["aresample=4000", 4000, 512, [12000]],
  ["aresample=16000,adelay=1S", 16000, 2049, [0, 12000]],
  ["adelay=1S,aresample=16000", 16000, 2050, [0, 4392, 12000, 14453, 12000, 10623]],
  ["aresample=16000,adelay=1", 16000, 2064, [...Array<number>(16).fill(0), 12000]],
  ["aresample=16000,atrim=end_sample=100", 16000, 100, [12000]],
  ["aresample=16000,asetrate=8000", 8000, 2048, [12000]],
  ["aresample=16000,aresample=8000", 8000, 1024, [12000]]
] as const) {
  for (const graph of [false, true]) it(`resamples at ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await convert(filter, { graph });
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    const pcm = Array.from(audio.channelData[0]!, sample => Math.round(sample * 32768));
    assert.equal(pcm.length, length);
    // FFmpeg 7.0.2 PCM16 reference values; floating FIR rounding can differ by one LSB.
    prefix.forEach((sample, i) => assert.ok(Math.abs(pcm[i]! - sample) <= 1, `${i}: ${pcm[i]} != ${sample}`));
    assert.ok(pcm.slice(40).every(sample => sample === 12000));
  });
}

it("keeps output -ar after the explicit resampler and subsequent filters", async () => {
  const { result, stderr, output } = await convert("aresample=16000,adelay=1S:all=1", { rate: 8000, channels: 2 });
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(output).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channels, 2);
  for (const [c, channel] of audio.channelData.entries()) {
    assert.equal(channel.length, 1025);
    assert.ok(channel.subarray(40).every(sample => sample === (c ? -6000 : 12000) / 32768));
  }
});

it("negotiates bare aresample with the output rate before the next filter", async () => {
  const { result, stderr, output } = await convert("aresample,adelay=1S", { rate: 16000 });
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(output).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channelData[0]!.length, 2049);
  assert.equal(audio.channelData[0]![0], 0);
  assert.ok(audio.channelData[0]!.subarray(1).every(sample => sample === 12000 / 32768));
});

for (const [length, expected] of [[20, 0], [22, 34], [32, 64]] as const) {
  it(`preserves resampler startup/flush behavior for ${length} samples`, async () => {
    const { result, stderr, output } = await convert("aresample=16000", { length });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(parseWav(output).tracks[0]!.decodedAudio!.channelData[0]!.length, expected);
  });
}

for (const filter of ["aresample=-1", "aresample=bad", "aresample=osr=", "aresample=2147483648",
  "aresample=16000:unknown=1", "aresample=2147483647"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const { result, output } = await convert(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "keep");
  });
}
