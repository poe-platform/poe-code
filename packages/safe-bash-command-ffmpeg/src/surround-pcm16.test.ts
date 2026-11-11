import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { surroundAudio } from "./audio-surround.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from({ length: 2048 }, (_, i) => (701 * (i % 32) - 12400) / 32768),
  Float64Array.from({ length: 2048 }, (_, i) => (11000 - 537 * (i % 43)) / 32768)
] }));
async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); },
      async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
      async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.wav") as Buffer };
}

// Native Linux FFmpeg 7.0.2, interleaved PCM16LE; every sample is checked.
for (const [filter, count, hash] of [
  ["anull", 2, "ab25814cdf3fc4aabda5908d5876f61242a81ae4aaf5ccdd7d84cc8ff52d37ad"],
  ["surround=win_size=1024", 6, "1855637e1470d359e60148725791fedd85e1aa399723457a0c143d5acebca7a2"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches every native PCM16 sample (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, count);
    assert.ok(audio.channelData.every(channel => channel.length === 2048));
    const pcm = Buffer.alloc(2048 * count * 2);
    for (let i = 0; i < 2048; i++) for (let c = 0; c < count; c++) {
      pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, (i * count + c) * 2);
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

it("accounts for single-precision FFT cosine tables before allocating them", async () => {
  const channels = [new Float32Array(32), new Float32Array(32)];
  const bytes = 32 * 6 * 4 + 1024 * (6 * 4 + 6 * 8 + 4) + (1024 / 4 + 1) * 4;
  await assert.rejects(surroundAudio(channels, 8000, "surround=win_size=1024",
    new MediaBudgetTracker({ maxMemoryBytes: bytes - 1 })), /maxMemoryBytes/);
  await surroundAudio(channels, 8000, "surround=win_size=1024",
    new MediaBudgetTracker({ maxMemoryBytes: bytes }));
});
