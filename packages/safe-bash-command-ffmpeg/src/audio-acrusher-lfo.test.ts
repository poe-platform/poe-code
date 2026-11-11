import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 8000 Hz with alternating signs.
for (const [filter, expected] of [
  ["acrusher=lfo=1", "fb010afced0528f8be0959f49d0d68f0931172ec052b05fed22e13fabd3242f6"],
  ["acrusher=lfo=1:lforate=200", "fb010afced0528f8be0959f49d0d68f0931172ec89157ee86f19ace43d1dd0e0"],
  ["acrusher=lfo=1:lforange=4:lforate=200", "fb010afced0568f0fb0172eced057ee8262305fe1c2713fa052b4dc9fb0157c5"],
  ["acrusher=lfo=0", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"],
  ["acrusher=lforate=200", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"],
  ["acrusher=lforange=4", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"],
  ["acrusher", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"]
] as const) for (const graph of [false, true]) {
  it(`matches native ${filter} at 8000 Hz through ${graph ? "filter_complex" : "af"}`, async () => {
    const { result, stderr, stdout } = await run(filter, graph, 1,
      "e80330f8b80b60f0881390e8581bc0e02823f0d8f82a20d1c83250c9983a80c1", "pipe:1", 8000);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.toString("hex"), expected);
  });
}

// Independent native PCM hashes cover many oscillator periods and packet boundaries.
for (const [sampleRate, channels, filter, expected] of [
  [8000, 1, "acrusher=lfo=1:lforange=4:lforate=200", "c7dfaf0340afb8ec46a4b0add2e37cfbe4b8adc622d0a74406fe9d6f2de48ecd"],
  [11025, 2, "acrusher=samples=249:lfo=1:lforange=250:lforate=200", "f1a7ad72b92566a3cb9c2645c73e4be6e84471b7dfd2f8af60881fa5624c9cb6"],
  [1000, 2, "acrusher=samples=3.5:lfo=1:lforange=20:lforate=0.01", "c368962c4df442f941160f3492af9ebbad76c167ae043387da698b65f051030d"]
] as const) for (const graph of [false, true]) {
  it(`preserves LFO phase and independent channel holds for ${filter} at ${sampleRate} Hz via ${graph ? "filter_complex" : "af"}`, async () => {
    const input = Buffer.alloc(4096 * 2);
    for (let i = 0; i < 4096; i++) input.writeInt16LE((i * 7919) % 60001 - 30000, i * 2);
    const { result, stderr, stdout } = await run(`asetnsamples=n=7:p=0,${filter}`, graph, channels,
      input.toString("hex"), "pipe:1", sampleRate);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, input.length);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), expected);
  });
}

for (const [filter, channels, expected] of [
  ["acrusher=lfo=true:lforange=4:lforate=200", 1, "fb010afced0568f08e1305fe821713fa2623e4d8fb01fbd4ed054dc9a93a05fe"],
  ["acrusher=1:1:8:0.5:0:1:0.5:3:1:4:200", 1, "fb010afced0568f08e1305fe821713fa2623e4d8fb01fbd4ed054dc9a93a05fe"],
  ["acrusher=samples=249:lfo=1:lforange=250:lforate=200", 1, "fb010afced0528f8be0959f49d0d68f09311e4d8fb01fbd4ed052ed1be0943cd"]
] as const) {
  it(`matches native positional and boundary options for ${filter}`, async () => {
    const { result, stderr, stdout } = await run(filter, false, channels,
      "e80330f8b80b60f0881390e8581bc0e02823f0d8f82a20d1c83250c9983a80c1");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.toString("hex"), expected);
  });
}

for (const option of ["lfo=2", "lfo=1+0", "lfo=NaN", "lforate=0", "lforate=201", "lforange=0", "lforange=251"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const { volume, result, stderr, stdout } = await run(`acrusher=${option}`, false, 1, undefined, "/out.pcm");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("acrusher:"), stderr);
    assert.equal(stdout.length, 0);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false, channels = 1, input = "0000cd0fc1d38d63", output = "pipe:1", sampleRate = 1000) {
  const volume = Volume.fromJSON({ "/in.pcm": Buffer.from(input, "hex"), "/out.pcm": "keep" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", String(sampleRate), "-ac", String(channels), "-i", "/in.pcm",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr, stdout: Buffer.concat(chunks) };
}
