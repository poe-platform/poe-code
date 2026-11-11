import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { crushAudio } from "./audio-acrusher.js";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output from FFmpeg 7.0.2, including silence and both signs.
for (const [filter, expected] of [
  ["anull", "0000cd0fc1d38d63"],
  ["acrusher=bits=8:mode=log", "0000e30fb6d3bd64"],
  ["acrusher=1:1:8:0.5:1", "0000e30fb6d3bd64"],
  ["acrusher=bits=4+4:mode=log:", "0000e30fb6d3bd64"],
  ["acrusher=bits=4:bits=default:mode=log", "0000e30fb6d3bd64"]
] as const) for (const graph of [false, true]) {
  it(`renders ${filter} through ${graph ? "filter_complex" : "af"}`, async () => {
    const { result, stderr, stdout } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.toString("hex"), expected);
  });
}

// Native FFmpeg 7.0.2: the report's samples followed by 1, -1, 32767, -32768.
for (const [filter, expected] of [
  ["acrusher", "0000ca0fcad37c6300000000ff7f0080"],
  ["acrusher=mode=log:aa=0", "0000e30fc3d211650100ffff3a7d0000"],
  ["acrusher=mode=log:aa=1", "0000dd0fbad3f3630100ffffff7f0080"],
  ["acrusher=mode=log:mix=0", "0000f90faad3ed650100ffffff7f0080"],
  ["acrusher=mode=log:mix=1", "0000cd0fc1d38d630100ffffff7f0080"],
  ["acrusher=bits=3.5:mode=log:level_in=2:level_out=0.5:dc=2", "000060101fd1af690100ffffde784584"],
  ["acrusher=bits=4:mode=lin:aa=0", "00006f108bd4fa6400000000ff7f0080"],
  ["acrusher=bits=1:mode=log", "0000930f52ca4f560100ffffff7f0080"],
  ["acrusher=bits=64:mode=log", "0000e647e1a9c671004000c0ff7f0080"]
] as const) for (const channels of [1, 2]) {
  it(`matches native ${filter} with ${channels} channels and full-scale PCM`, async () => {
    const { result, stderr, stdout } = await run(filter, false, channels, "0000cd0fc1d38d630100ffffff7f0080");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.toString("hex"), expected);
  });
}

// Native FFmpeg 7.0.2 exit statuses and the upper bits boundary PCM.
for (const [option, exitCode, error] of [
  ["bits=0", 222, "invalid bits"],
  ["bits=oops", 234, "invalid or unsupported expression"],
  ["typo=3", 8, "unsupported option typo=3"],
  ["bits=64", 0, ""]
] as const) for (const graph of [false, true]) {
  it(`matches native status and stdout for acrusher=${option} through ${graph ? "filter_complex" : "af"}`, async () => {
    const input = "e80330f8b80b60f0881390e8581bc0e02823f0d8f82a20d1c83250c9983a80c1";
    const { result, stderr, stdout } = await run(`acrusher=${option}`, graph, 1, input);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(stderr, error ? `ffmpeg: acrusher: ${error}\n` : "");
    assert.equal(stdout.toString("hex"), exitCode === 0 ? input : "");
  });
}

// Native FFmpeg 7.0.2 PCM16 for alternating signs, including the initial silent hold.
for (const [filter, expected] of [
  ["acrusher=samples=3", "fb010afca70b05fe980f7ee8fb01ace4262305fe1c272ed1fb0143cda93a05fe"],
  ["acrusher=1:1:8:0.5:lin:1:0.5:3", "fb010afca70b05fe980f7ee8fb01ace4262305fe1c272ed1fb0143cda93a05fe"],
  ["acrusher=samples=2.5", "fb010afca70b05fe980f7ee8fb01ace4262305fe1c272ed1fb0143cda93a05fe"],
  ["acrusher=samples=1", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"],
  ["acrusher", "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1"]
] as const) for (const frameFilter of ["", "asetnsamples=n=4:p=0,"]) for (const graph of [false, true]) {
  it(`preserves sample holds for ${frameFilter}${filter} through ${graph ? "filter_complex" : "af"}`, async () => {
    const input = Buffer.alloc(32);
    for (let i = 0; i < 16; i++) input.writeInt16LE((i + 1) * 1000 * (i % 2 === 0 ? 1 : -1), i * 2);
    const { result, stderr, stdout } = await run(frameFilter + filter, graph, 1, input.toString("hex"));
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.toString("hex"), expected);
  });
}

for (const [samples, expected] of [
  [3, [0, 0, 0, 0, 5000, -6000, 5000, -6000, 5000, -6000, 11000, -12000, 11000, -12000, 11000, -12000]],
  [2.49, [0, 0, 3000, -4000, 3000, -4000, 7000, -8000, 7000, -8000, 11000, -12000, 11000, -12000, 15000, -16000]],
  [250, Array<number>(16).fill(0)]
] as const) {
  it(`holds stereo channels independently with samples=${samples} and input/output gain`, async () => {
    const { result, stderr, stdout } = await run(
      `asetnsamples=n=4:p=0,acrusher=samples=${samples}:mix=1:level_in=2:level_out=0.5`, false, 2,
      "e80330f8b80b60f0881390e8581bc0e02823f0d8f82a20d1c83250c9983a80c1");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Array.from({ length: stdout.length / 2 }, (_, i) => stdout.readInt16LE(i * 2)), expected);
  });
}

for (const option of ["bits=0", "bits=65", "bits=", "bits=NaN", "mode=unknown", "mode=2", "aa=-1", "aa=2",
  "mix=2", "dc=0", "level_in=0", "level_out=65", "samples=0", "samples=251", "samples=NaN", "lfo=2", "unknown=1"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const { volume, result, stderr, stdout } = await run(`acrusher=${option}`, false, 1, undefined, "/out.pcm");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("acrusher:"), stderr);
    assert.equal(stdout.length, 0);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

it("accounts for output memory and honors cancellation", async () => {
  const channels = [new Float64Array(32)];
  await assert.rejects(crushAudio(channels, 1000, "acrusher=mode=log", new MediaBudgetTracker({ maxMemoryBytes: 128 })), /maxMemoryBytes/);
  await assert.rejects(crushAudio(channels, 1000, "acrusher=mode=log", new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, channels = 1, input = "0000cd0fc1d38d63", output = "pipe:1") {
  const volume = Volume.fromJSON({ "/in.pcm": Buffer.from(input, "hex"), "/out.pcm": "keep" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.pcm",
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
