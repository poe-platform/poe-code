import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 s16le output for the reported 8 kHz mono WAV.
const original = "e80330f8b80b60f0881390e8581bc0e02823f0d8f82a20d1c83250c9983a80c1";
const crushed = "f60328f8a70b68f08e137ee8541bd0e02623e4d8052b2ed1bd324dc9a93a7ec1";
const lastHalf = "e80330f8b80b60f0881390e8581bc0e02623e4d8052b2ed1bd324dc9a93a7ec1";
for (const [filter, expected] of [
  ["asetnsamples=n=4:p=0,acrusher=enable='gte(t,0.001)'", lastHalf],
  ["acrusher=enable=0", original],
  ["acrusher=enable=1", crushed],
  ["anull", original],
  ["acrusher", crushed],
  // A threshold inside a frame must wait for the next frame's timestamp.
  ["asetnsamples=n=4:p=0,acrusher=enable='gte(t,0.00075)'", lastHalf],
  ["asetnsamples=n=4:p=0,acrusher=enable='gte(n,2)'", lastHalf],
  ["asetnsamples=n=4:p=0,asetpts=PTS+8,acrusher=enable='gte(t,0.001)'", crushed],
  ["acrusher=enable=0.49", original],
  ["acrusher=enable=-0.5", crushed],
  ["acrusher=enable=0/0", original],
  ["acrusher=enable=1/0", crushed],
  ["acrusher=enable=NAN", original],
  ["acrusher=enable=nan", original],
  ["acrusher=enable=NaN", original],
  ["acrusher=enable=inf", crushed],
  ["acrusher=enable=INF", crushed],
  ["acrusher=enable=-inf", crushed],
  ["acrusher=enable=Infinity", crushed],
  ["acrusher=enable=isnan(nan)", crushed],
  ["acrusher=enable=isinf(inf)", crushed],
  ["asetnsamples=n=4:p=0,asetpts=NAN,acrusher=enable='isnan(t)'", crushed],
  ["asetnsamples=n=4:p=0,acrusher=enable='gt(st(0,ld(0)+1),4)'", lastHalf]
] as const) for (const graph of [false, true]) {
  it(`matches frame-based acrusher enable for ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, stdout } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.toString("hex"), expected);
  });
}

for (const options of ["samples=3", "samples=3:lfo=1:lforate=200"]) it(`pauses ${options} during bypass and resumes on the next enabled frame`, async () => {
  const actual = await run(`asetnsamples=n=4:p=0,acrusher=${options}:enable='not(mod(n,2))'`);
  const active = await run(`asetnsamples=n=4:p=0,aselect='not(mod(n,2))',acrusher=${options}`);
  for (const output of [actual, active]) assert.equal(output.result.exitCode, 0, output.stderr);
  const input = Buffer.from(original, "hex");
  assert.deepEqual(actual.stdout, Buffer.concat([
    active.stdout.subarray(0, 8), input.subarray(8, 16),
    active.stdout.subarray(8, 16), input.subarray(24, 32)
  ]));
});

for (const enable of ["", "unknown", "nanx", "infinite", "gte(t,)"]) {
  it(`rejects invalid acrusher enable=${enable} without replacing output`, async () => {
    const { volume, result, stderr, stdout } = await run(`acrusher=enable='${enable}'`, false, "/out.pcm");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("acrusher enable"), stderr);
    assert.equal(stdout.length, 0);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph = false, output = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from([1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
      9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000], sample => sample / 32768)
  ] }, { bitsPerSample: 16 }));
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
