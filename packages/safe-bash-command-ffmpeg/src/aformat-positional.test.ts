import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [12000, -4000].map(sample => new Float64Array(1024).fill(sample / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxMemoryBytes: 16 * 1024 * 1024 } }).execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
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

// FFmpeg's positional order is sample_fmts, sample_rates, channel_layouts.
for (const [filter, levels] of [
  ["aformat", [12000, -4000]],
  ["aformat=s16", [12000, -4000]],
  ["aformat=u8", [11776, -4096]],
  ["aformat=s16:8000", [12000, -4000]],
  ["aformat=s16:8000:", [12000, -4000]],
  ["aformat=s16:8000:mono", [4000]],
  ["aformat=s16:8000:cl=mono", [4000]],
  ["aformat=s16:r=8000:cl=mono", [4000]],
  ["aformat=f=s16:r=8000:cl=mono", [4000]],
  ["aformat=sample_fmts=s16:sample_rates=8000:channel_layouts=mono", [4000]],
  ["aformat=cl=mono", [4000]]
] as const) {
  for (const graph of [false, true]) it(`reads ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await convert(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, levels.length);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 1024);
      assert.ok(channel.every(sample => sample * 32768 === levels[c]));
    }
  });
}

for (const filter of ["aformat=s16:16000:mono", "aformat=f=s16:r=16000:cl=mono",
  "aformat=sample_rates=16000:cl=mono"]) {
  for (const graph of [false, true]) it(`resamples ${filter} before subsequent filters (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await convert(`${filter},adelay=1`, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 16000);
    assert.equal(audio.channels, 1);
    const channel = audio.channelData[0]!;
    assert.equal(channel.length, 2048 + 16);
    assert.ok(channel.subarray(0, 16).every(sample => sample === 0));
    assert.ok(channel.subarray(16).every(sample => sample * 32768 === 4000));
  });
}

for (const filter of ["aformat=::mono", "aformat=s16::mono",
  "aformat=s16:8000:mono:extra", "aformat=invalid:8000:mono", "aformat=s16:invalid:mono",
  "aformat=s16:0:mono", "aformat=s16:-8000:mono",
  "aformat=s16:2147483648:mono", "aformat=s16:2147483647:mono", "aformat=r=", "aformat=unknown=s16"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const { result, output } = await convert(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "keep");
  });
}
