import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string) {
  const volume = Volume.fromJSON({ "/out.wav": "KEEP" });
  volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
    channels: [new Float64Array(2048).fill(8000 / 32768)] }));
  volume.writeFileSync("/steps.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 2048 }, (_, i) => Math.floor(i / 512) % 2 * 20000 / 32768)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/steps.wav", "-filter_complex", graph,
      "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.wav") as Buffer };
}

// Native FFmpeg 7.0.2 references: identical graph and WAV inputs, decoded with -f s16le.
// Hashes cover every sample, including both attack transitions and the release between them.
for (const [name, graph, frames, initial, attack, hash] of [
  ["control gain", "[1:a]volume=0.5[x];[0:a][x]sidechaingate[o]", 2048, 8000, 1192,
    "cbdc88db038d3e500dc3aa0ea420391d96a59f24fad1d149bb53e57b8fd12a43"],
  ["program gain", "[0:a]volume=0.5[x];[x][1:a]sidechaingate[o]", 2048, 4000, 2384,
    "cf81c536be9f809e5c8cc65eb6370f207adf4eb467d2fb9c7c012d19a6b864cd"],
  ["control identity", "[1:a]anull[x];[0:a][x]sidechaingate[o]", 2048, 8000, 4768,
    "332db1284876b9864adbdeeefd336fb64d46339b65d8abe628814d8e3769eae7"],
  ["both branches and downstream gain",
    "[0:a]volume=0.5[p];[p]volume=0.5[m];[1:a]volume=0.5[c];[m][c]sidechaingate,volume=0.5[o]",
    2048, 1000, 149, "9d91f3bc232c43b392323ce8ae5e56f4ecfe947bf30bce87afff4dd40679dd09"],
  ["program trim", "[0:a]atrim=end_sample=1200,volume=0.5[p];[p][1:a]sidechaingate[o]", 1200, 4000, 2384,
    "286f90c8b1792771cdf2d50146466c212038d6f317ff3892a7626e3c30be4a08"],
  ["control trim", "[1:a]atrim=end_sample=1024,volume=0.5[c];[0:a][c]sidechaingate[o]", 1024, 8000, 1192,
    "5a9f7204290533935d9be4c867ac6fb20816c4c9e6c1e7fc557bc76b3d9d07ac"]
] as const) {
  it(`sidechaingate applies upstream ${name} independently`, async () => {
    const { result, stderr, output } = await run(graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.equal(audio.channelData[0]!.length, frames);
    const samples = Array.from(audio.channelData[0]!, sample => sample * 32768);
    assert.equal(samples[0], initial);
    assert.equal(samples[512], attack);
    const pcm = Buffer.alloc(samples.length * 2);
    for (const [index, sample] of samples.entries()) pcm.writeInt16LE(sample, index * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const graph of [
  "[0:a]volume=invalid[p];[p][1:a]sidechaingate[o]",
  "[1:a]volume=invalid[c];[0:a][c]sidechaingate[o]"
]) {
  it(`sidechaingate rejects invalid upstream filters without replacing output: ${graph}`, async () => {
    const { result, stderr, output } = await run(graph);
    assert.equal(result.exitCode, 234, stderr);
    assert.ok(stderr.includes("volume"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
