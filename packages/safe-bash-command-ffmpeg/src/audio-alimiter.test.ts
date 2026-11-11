import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg references: consecutive peaks wrap a two-sample lookahead.
for (const [attack, latency, scales, expected] of [
  [0.25, 1, [1], [[2000, 1303, 8192, -1212, -3000, -6000]]],
  [0.25, 0, [1], [[0, 2000, 1303, 8192, -1212, -3000]]],
  [1, 1, [1], [[955, 781, 8192, 8192, -7737, -8192]]],
  [0.125, 1, [1], [[2000, 2000, 8192, 8192, -8192, -8192]]],
  [0.375, 1, [1], [[1536, 1071, 8192, 1923, 3864, -3000]]],
  [0.25, 1, [1, -0.5], [[2000, 1303, 8192, 8192, -7737, -8192], [-1000, -652, -4096, -4096, 3868, 4096]]]
] as const) it(`alimiter consecutive peaks with attack=${attack}, latency=${latency}, ${scales.length} channels`, async () => {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: scales.map(scale => Float64Array.from([2000, 2000, 27000, 27000, -24000, -24000], sample => sample * scale / 32768)) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", "-af", `alimiter=limit=0.25:level=0:latency=${latency}:attack=${attack}:release=1`, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
});

// Native FFmpeg PCM16 references for quiet/loud/quiet transitions.
for (const [filter, length, scales, indices, expected] of [
  ["alimiter=limit=0.25:level=0:latency=1", 32000, [1], [4000, 12000, 16000, 20000, 24000, 28000, 31999], [[500, 4000, 8192, 8192, 513, 1000, -1000]]],
  ["alimiter=limit=0.25:level=0:latency=1", 32000, [1, -0.25], [4000, 12000, 20000, 28000], [[500, 4000, 8192, 1000], [-125, -1000, -2048, -250]]],
  ["alimiter=limit=0.25:level=0", 32000, [1], [0, 38, 39, 4039, 12039, 20039, 28039], [[0, 0, 500, 500, 4000, 8192, 1000]]],
  ["alimiter=limit=0.25:latency=true,volume=0.5", 32000, [1], [4000, 12000, 20000, 28000], [[1000, 8000, 16384, 2000]]],
  ["alimiter=latency=1", 7, [1], [0, 6], [[500, 500]]],
  ["alimiter", 7, [1], [0, 6], [[0, 0]]],
  ["alimiter=latency=1", 997, [0], [0, 996], [[0, 0]]],
  ["alimiter=level_in=2:level_out=0.5:limit=0.4:attack=2:release=10:latency=1", 32000, [1, 1], [4000, 12000, 15990, 16000, 20000, 24000, 24040, 28000, 31999], [[1250, 10000, 7786, 16384, 16384, 1042, -1780, 2500, -2500], [1250, 10000, 7786, 16384, 16384, 1042, -1780, 2500, -2500]]],
  ["alimiter=1:1:0.25:5:50:0:0.5:0:1", 32000, [1], [4000, 12000, 20000, 28000], [[500, 4000, 8192, 1000]]]
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

for (const [filter, exitCode] of [
  ...["limit=0", "limit=1.1", "attack=0", "attack=81", "release=0", "release=8001", "level_in=0", "level_out=65"]
    .map(option => [`alimiter=${option}`, 222] as const),
  ["alimiter=unknown=1", 8],
  ...["limit=NaN", "limit=", "latency=2", "asc=2",
    ...["asc", "level", "latency"].flatMap(key => ["1.0", "0x1", "0.0", "0x0", "1e0", ""].map(value => `${key}=${value}`))]
    .map(option => [`alimiter=${option}`, 234] as const)
] as const) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, exitCode);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const [token, value] of [["TrUe", "1"], ["YeS", "1"], ["ON", "1"], ["FaLsE", "0"], ["No", "0"], ["OFF", "0"]]) {
  for (const key of ["latency", "level", "asc"]) {
    it(`alimiter ${key}=${token} produces the same PCM as ${value}`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 3087 }, (_, i) => Math.sin(i / 8) * 0.5)] }));
      for (const option of [value, token]) {
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-i", "/in.wav", "-af", `alimiter=limit=0.25:${key}=${option}`, "-f", "s16le", `/${option}.pcm`],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
        } as never);
        assert.equal(result.exitCode, 0);
      }
      assert.deepEqual(fs.readFileSync(`/${token}.pcm`), fs.readFileSync(`/${value}.pcm`));
    });
  }
}
