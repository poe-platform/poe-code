import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 reference for quiet/loud/quiet transitions.
for (const [filter, length, scales, indices, expected] of [
  ["dynaudnorm=f=100:g=5:p=0.5", 32000, [1], [0, 4000, 7999, 8000, 12000, 20000, 24000, 28000, 31999], [[500, 5000, -1961, 15692, 15692, 16339, 1021, 9600, -997]]],
  ["dynaudnorm=framelen=100:gausssize=4:peak=0.5:maxgain=3", 32000, [1, -0.25], [0, 4000, 7999, 8000, 12000, 20000, 24000, 28000, 31999], [[500, 1500, -1369, 10955, 10955, 15898, 994, 3000, -972], [-125, -375, 342, -2739, -2739, -3974, -248, -750, 243]]],
  ["dynaudnorm", 997, [1], [0, 249, 498, 996], [[500, -500, 500, 500]]],
  ["dynaudnorm=p=0", 997, [1], [0, 249, 498, 996], [[0, 0, 0, 0]]],
  ["dynaudnorm", 997, [0], [0, 249, 498, 996], [[0, 0, 0, 0]]],
  ["dynaudnorm=100:5:0.5,volume=0.5", 32000, [1], [4000, 12000, 20000, 28000], [[2500, 7846, 8170, 4800]]]
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

for (const [expression, literal] of [
  ["f=10:g=3:p=1/2", "f=10:g=3:p=0.5"],
  ["f=10*2:g=3", "f=20:g=3"],
  ["framelen=(10+10)*5:gausssize=2+3:peak=1/2:maxgain=sqrt(9)", "framelen=100:gausssize=5:peak=0.5:maxgain=3"],
  ["10*2:1+2:2^-1:6/2", "20:3:0.5:3"]
]) for (const graph of [false, true]) it(`dynaudnorm=${expression} matches literal PCM (${graph ? "graph" : "simple"})`, async () => {
  const fs = Volume.fromJSON({});
  const samples = Float64Array.from({ length: 8137 }, (_, i) =>
    (i % 16 < 8 ? 1 : -1) * [500, 4000, 16000, 1000][Math.floor(i / 2048)]! / 32768);
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  for (const [name, options] of [["literal", literal], ["expression", expression]]) {
    const filter = `dynaudnorm=${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", `/${name}.pcm`],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
  }
  assert.equal(fs.statSync("/expression.pcm").size, samples.length * 2);
  assert.deepEqual(fs.readFileSync("/expression.pcm"), fs.readFileSync("/literal.pcm"));
});

for (const filter of ["dynaudnorm=f=0", "dynaudnorm=f=8001", "dynaudnorm=f=1.5", "dynaudnorm=g=2", "dynaudnorm=g=302", "dynaudnorm=g=3.5", "dynaudnorm=p=1.1", "dynaudnorm=p=-1", "dynaudnorm=m=0", "dynaudnorm=m=101", "dynaudnorm=p=NaN", "dynaudnorm=f=", "dynaudnorm=r=0.5", "dynaudnorm=p=1/", "dynaudnorm=p=unknown", "dynaudnorm=p=1/0", "dynaudnorm=p=0/0", "dynaudnorm=p=3/2", "dynaudnorm=p=-1/2", "dynaudnorm=f=5*1", "dynaudnorm=f=8000+1", "dynaudnorm=g=1+1", "dynaudnorm=g=300+2", "dynaudnorm=m=1/2", "dynaudnorm=m=100+1"]) {
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
