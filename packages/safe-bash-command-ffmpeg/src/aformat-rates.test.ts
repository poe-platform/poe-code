import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [12000, -4000].map(level => new Float64Array(1024).fill(level / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxMemoryBytes: 16 * 1024 * 1024 } }).execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "/out.wav"],
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

// FFmpeg native PCM16 reference: preserve an allowed input rate, otherwise
// choose the nearest allowed rate, independently of its position in the list.
for (const [filter, rate, length, delay] of [
  ["aformat", 8000, 1024, false],
  ["aformat=sample_rates=16000", 16000, 2048, false],
  ["aformat=r=16000", 16000, 2048, false],
  ["aformat=sample_rates=16000|8000", 8000, 1024, false],
  ["aformat=r=8000|16000", 8000, 1024, false],
  ["aformat=sample_rates=11025|16000", 11025, 1412, false],
  ["aformat=sample_rates=16000|11025", 11025, 1412, false],
  ["aformat=r=4000|11025", 11025, 1412, false],
  ["aformat=r=4000", 4000, 512, false],
  ["aformat=sample_rates=16000,adelay=1S", 16000, 2049, true],
  ["aformat=r=16000,atrim=end_sample=100", 16000, 100, false],
  ["aformat=r=16000,aformat=r=8000", 8000, 1024, false]
] as const) {
  for (const graph of [false, true]) it(`negotiates ${filter} (graph=${graph})`, async () => {
    const { result, stderr, output } = await convert(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    assert.equal(audio.channels, 2);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, length);
      const expected = c === 0 ? 12000 : -4000;
      assert.deepEqual(Array.from(channel, sample => Math.round(sample * 32768)),
        Array.from({ length }, (_, i) => delay && (c === 0 ? i === 0 : i === length - 1) ? 0 : expected));
    }
  });
}

for (const value of ["bogus", "8000|bogus", "0", "-1", "2147483648", "2147483647"]) {
  for (const key of ["sample_rates", "r"]) it(`rejects unsafe ${key}=${value} without replacing output`, async () => {
    const { result, output } = await convert(`aformat=${key}=${value}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "keep");
  });
}
