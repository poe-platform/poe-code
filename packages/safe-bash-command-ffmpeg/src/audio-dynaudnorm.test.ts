import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  ["f=min:g=min:p=min:m=min", "f=10:g=3:p=0:m=1"],
  ["framelen=max:gausssize=max:peak=max:maxgain=max", "f=8000:g=301:p=1:m=100"],
  ["f=default:g=default:p=default:m=default", "f=500:g=31:p=0.95:m=10"],
  ["framelen=min:gausssize=min:peak=min:maxgain=min", "f=10:g=3:p=0:m=1"],
  ["f=max:g=max:p=max:m=max", "f=8000:g=301:p=1:m=100"],
  ["framelen=default:gausssize=default:peak=default:maxgain=default", "f=500:g=31:p=0.95:m=10"],
  ["min:min:max:default", "10:3:1:10"],
  ["f=20:f=default:g=5:g=default:p=0.1:p=default:m=2:m=default", "500:31:0.95:10"],
  ["f=min*2:g=min+2:p=max/2:m=default/2", "20:5:0.5:5"],
  ["f=10:g=3:p=1/E:m=PHI", "10:3:0.36787944117144233:1.618033988749895"],
  ["f=10:g=3:r=min", "10:3:0.95:10:0"],
  ["f=10:g=3:targetrms=max", "10:3:0.95:10:1"],
  ["f=10:g=3:r=0.2:targetrms=default", "10:3:0.95:10:0"],
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

for (const filter of ["dynaudnorm=f=min-0.1", "dynaudnorm=g=max+0.1", "dynaudnorm=p=max+0.1", "dynaudnorm=m=min-0.1", "dynaudnorm=r=max+0.1", "dynaudnorm=p=pi", "dynaudnorm=f=0", "dynaudnorm=f=8001", "dynaudnorm=f=1.5", "dynaudnorm=g=2", "dynaudnorm=g=302", "dynaudnorm=p=1.1", "dynaudnorm=p=-1", "dynaudnorm=m=0", "dynaudnorm=m=101", "dynaudnorm=p=NaN", "dynaudnorm=f=", "dynaudnorm=r=-0.1", "dynaudnorm=targetrms=1.1", "dynaudnorm=r=NaN", "dynaudnorm=r=1/0", "dynaudnorm=p=1/", "dynaudnorm=p=unknown", "dynaudnorm=p=1/0", "dynaudnorm=p=0/0", "dynaudnorm=p=3/2", "dynaudnorm=p=-1/2", "dynaudnorm=f=5*1", "dynaudnorm=f=8000+1", "dynaudnorm=g=1+1", "dynaudnorm=g=300+2", "dynaudnorm=m=1/2", "dynaudnorm=m=100+1"]) {
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

// Native FFmpeg PCM16 hashes cover coupled RMS, disabled RMS, silence and a short final frame.
for (const [options, length, scales, hash] of [
  ["f=10:g=3:r=0.2", 120, [1, 4], "8c7a7108d9da99f3d85530773ad56fdf6b0b3b90c315912df9b4d461ac5ea795"],
  ["f=10:g=3:targetrms=1/5", 120, [1, 4], "8c7a7108d9da99f3d85530773ad56fdf6b0b3b90c315912df9b4d461ac5ea795"],
  ["10:3:0.95:10:0.2", 120, [1, 4], "8c7a7108d9da99f3d85530773ad56fdf6b0b3b90c315912df9b4d461ac5ea795"],
  ["f=10:g=3:r=0", 120, [1, 4], "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
  ["f=10:g=3:r=1", 120, [1, 4], "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
  ["f=10:g=3:r=0.2", 117, [1], "e013eaebd257de46df1cfffbf1463fd7542ae4f5ce6ec55d4ae9b215be48306b"],
  ["f=10:g=3:r=0.2", 120, [0, 0], "4b48f21a4b7a02bfbec19ef880a967a02334a3cdcef8ae83de2ef327ba8bc5dd"]
] as const) for (const graph of [false, true]) it(`dynaudnorm=${options} matches native RMS PCM (${length}, ${scales}, ${graph ? "graph" : "simple"})`, async () => {
  const fs = Volume.fromJSON({});
  const samples = Float64Array.from({ length }, (_, i) => (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000, channels: scales.map(scale => samples.map(value => value * scale)) }));
  const filter = `dynaudnorm=${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = fs.readFileSync("/out.pcm") as Buffer;
  assert.equal(pcm.length, length * scales.length * 2);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
});

// Native FFmpeg 7.0.2 PCM16 references for a stereo level step at 60 ms.
for (const [option, hash] of [
  ["p=max", "99b69ebd545d96130225e05ebbfa5953bc9ee2a93c0c8d61f93e62cc39f315ba"],
  ["m=default", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
  ["p=1/PI", "a4b10e8320dbe49bc2b68d5d1eb6ec9b22d8058a2446e7b830f0b50c7b0a9ada"]
]) for (const graph of [false, true]) it(`dynaudnorm ${option} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
  const samples = Float64Array.from({ length: 120 }, (_, i) =>
    (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({
    sampleRate: 1000, channels: [samples, samples.map(value => value * 4)]
  })) });
  const filter = `dynaudnorm=f=10:g=3:${option}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = fs.readFileSync("/out.pcm") as Buffer;
  assert.equal(output.length, 480);
  assert.equal(createHash("sha256").update(output).digest("hex"), hash);
});
