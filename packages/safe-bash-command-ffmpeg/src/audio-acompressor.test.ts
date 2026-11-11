import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 references for quiet/loud/quiet transitions.
for (const [filter, length, scales, indices, expected] of [
  ["acompressor", 32000, [1], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[500, 500, 4000, 4000, 3805, 3770, 14430, 13857, 8250, 8095, 506, 506, 532, 1000, -1000]]],
  ["acompressor=threshold=0.1:ratio=4:attack=100:release=500", 32000, [1], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[500, 500, 4000, 4000, 3897, 3319, 13023, 12782, 6656, 4871, 305, 305, 316, 986, -1000]]],
  ["acompressor=threshold=0.1:ratio=4:attack=1:release=20:link=maximum", 32000, [1, -0.25], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[500, 500, 3797, 3546, 3319, 3319, 6175, 5384, 4871, 4871, 307, 310, 771, 1000, -1000], [-125, -125, -949, -886, -830, -830, -1544, -1346, -1218, -1218, -77, -78, -193, -250, 250]]],
  ["acompressor=threshold=0.1:ratio=4:attack=1:release=20:link=average:detection=peak", 32000, [1, -0.25], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[500, 500, 4000, 4000, 3911, 3911, 9858, 8097, 6930, 6930, 441, 449, 1000, 1000, -1000], [-125, -125, -1000, -1000, -978, -978, -2465, -2024, -1732, -1732, -110, -112, -250, -250, 250]]],
  ["acompressor=mode=upward:threshold=0.1:ratio=4:attack=1:release=20", 32000, [1], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[2656, 2048, 4679, 4320, 4151, 4151, 16000, 16000, 16000, 16000, 1000, 1000, 1013, 2435, -2435]]],
  ["acompressor=knee=1:level_in=0.5:makeup=2:mix=0.5", 32000, [1], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[375, 375, 3000, 3000, 3000, 3000, 12000, 12000, 9833, 9724, 608, 608, 626, 750, -750]]],
  ["acompressor=threshold=0.1:ratio=4:attack=1:release=20,volume=0.5", 32000, [1], [0, 4000, 8000, 8001, 8100, 12000, 16000, 16001, 16100, 20000, 24000, 24001, 24100, 28000, 31999], [[250, 250, 1898, 1773, 1660, 1660, 3087, 2692, 2435, 2435, 154, 155, 385, 500, -500]]],
  ["acompressor=threshold=0.1:ratio=4:attack=1:release=20", 32000, [1], [4000, 8000, 12000, 16000, 20000, 24000, 28000, 31999], [[500, 3797, 3319, 6175, 4871, 307, 1000, -1000]]],
  ["acompressor", 997, [0], [0, 996], [[0, 0]]]
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

for (const filter of ["acompressor=threshold=0", "acompressor=ratio=21", "acompressor=attack=0", "acompressor=release=9001", "acompressor=knee=0", "acompressor=mix=2", "acompressor=detection=bad", "acompressor=link=2", "acompressor=mode=bad", "acompressor=threshold=NaN", "acompressor=attack=", "acompressor=unknown=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
