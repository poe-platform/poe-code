import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16: four stereo frames of (12000, -16000) at 1 kHz.
for (const [options, hex] of [
  ["mode=max", "e02ec0e0302a00e7802540edd02080f3"],
  ["mode=sawdown", "e02ec0e0302a00e7802540edd02080f3"],
  ["mode=min", "7017c0e037251ef3ba2d78feba2d78fe"],
  ["mode=default", "7017c0e037251ef3ba2d78feba2d78fe"],
  ["mode=sine", "7017c0e037251ef3ba2d78feba2d78fe"],
  ["timing=min", "7017c0e0bb1725e1071889e15218eee1"],
  ["timing=bpm", "7017c0e0bb1725e1071889e15218eee1"],
  ["timing=max", "7017c0e037251ef3ba2d78feba2d78fe"],
  ["timing=default", "7017c0e037251ef3ba2d78feba2d78fe"],
  ["timing=hz", "7017c0e037251ef3ba2d78feba2d78fe"],
  ["amount=min", "e02e80c1e02e80c1e02e80c1e02e80c1"]
]) {
  for (const graph of [false, true]) {
    it(`apulsator ${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, pcm } = await run(`hz=100:${options}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(pcm.toString("hex"), hex);
    });
  }
}

for (const [options, control] of [
  ["mode=sawdown:mode=default", "mode=sine"],
  ["timing=bpm:timing=default", "timing=hz"],
  ["mode=(min+max)/2", "mode=square"],
  ["mode=max-triangle", "mode=sawup"],
  ["mode=default+0.5", "mode=sine"],
  ["timing=(min+max)/2:ms=10", "timing=ms:ms=10"],
  ["timing=default-ms:ms=10", "timing=ms:ms=10"],
  ["timing=max-0.5", "timing=hz"],
  ["1:1:max:1:0:0.5:1:default:120:500:100", "mode=sawdown:hz=100"]
]) {
  it(`apulsator ${options} matches ${control}`, async () => {
    const expected = await run(`hz=100:${control}`);
    const actual = await run(options!.includes("=") ? `hz=100:${options}` : options!);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.pcm, expected.pcm);
  });
}

for (const option of ["mode=min-0.1", "mode=max+0.1", "timing=min-0.1", "timing=max+0.1"]) {
  it(`apulsator ${option} rejects out-of-range values without replacing output`, async () => {
    const { result, pcm } = await run(option);
    assert.notEqual(result.exitCode, 0);
    assert.equal(pcm.toString(), "keep");
  });
}

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 1000,
    channels: [new Float64Array(4).fill(12000 / 32768), new Float64Array(4).fill(-16000 / 32768)]
  }));
  let stderr = "";
  const filter = `apulsator=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, pcm: volume.readFileSync("/out.raw") as Buffer };
}
