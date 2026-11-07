import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 reference for quiet/loud/quiet transitions.
for (const [filter, length, scales, indices, expected] of [
  ["speechnorm=peak=0.5:expansion=3:compression=4:threshold=0.1:raise=0.01:fall=0.02", 32000, [1], [0, 4000, 12000, 20000, 24000, 28000, 31999], [[1490, 125, 12000, 16384, 1004, 250, -250]]],
  ["speechnorm=0.5:3:4:0.1:0.01:0.02", 32000, [1], [0, 4000, 12000, 20000, 24000, 28000, 31999], [[1490, 125, 12000, 16384, 1004, 250, -250]]],
  ["speechnorm=p=0.5", 32000, [1], [4000, 12000, 20000, 24000, 28000, 31999], [[1000, 8000, 16384, 1025, 1525, -2000]]],
  ["speechnorm=peak=0.5,volume=0.5", 32000, [1], [4000, 12000, 20000, 24000, 28000, 31999], [[500, 4000, 8192, 512, 762, -1000]]],
  ["speechnorm", 997, [0], [0, 498, 996], [[0, 0, 0]]],
  ["speechnorm=p=0", 997, [1], [0, 498, 996], [[0, 0, 0]]],
  ["speechnorm=0.5", 997, [1, -0.25], [0, 498, 996], [[1000, 1000, 1000], [-250, -250, -250]]]
] as const) for (const graph of [false, true]) it(`${filter}, ${length} samples follows changing levels (${graph ? "graph" : "simple"})`, async () => {
  const fs = Volume.fromJSON({});
  const samples = Float64Array.from({ length }, (_, i) =>
    (i % 16 < 8 ? 1 : -1) * [500, 4000, 16000, 1000][Math.floor(i / 8000)]! / 32768);
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: scales.map(scale => samples.map(value => value * scale)) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channelData.length, scales.length);
  for (const [c, channel] of audio.channelData.entries()) {
    assert.equal(channel.length, length);
    indices.forEach((position, i) => assert.ok(Math.abs(channel[position]! * 32768 - expected[c]![i]!) <= 1,
      `channel ${c}, sample ${position}: ${channel[position]! * 32768}, expected ${expected[c]![i]}`));
  }
});


for (const filter of ["speechnorm=p=-1", "speechnorm=p=1.1", "speechnorm=p=NaN", "speechnorm=p=", "speechnorm=e=0", "speechnorm=e=51", "speechnorm=c=0", "speechnorm=c=51", "speechnorm=t=-1", "speechnorm=r=1.1", "speechnorm=f=-1", "speechnorm=l=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
