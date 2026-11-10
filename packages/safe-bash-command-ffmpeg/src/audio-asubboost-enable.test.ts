import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete s16le output captured with native FFmpeg 7.0.2 for the reported cases.
for (const [filter, expected] of [
  ["anull", "0080803ec0e0e02ea00f401fe02ea00f803e60f0e02ec0e0401f20d1a00f80c1"],
  ["asetnsamples=n=2:p=0,asubboost=wet=0", "00".repeat(32)],
  ["asetnsamples=n=2:p=0,asubboost=wet=0:enable=n", "0080803ec0e0e02e" + "00".repeat(24)],
  ["asetnsamples=n=2:p=0,asubboost=wet=0:enable=gte(t\\,0.0005)", "0080803ec0e0e02ea00f401fe02ea00f" + "00".repeat(16)],
  ["asubboost=wet=0:enable=0", "0080803ec0e0e02ea00f401fe02ea00f803e60f0e02ec0e0401f20d1a00f80c1"],
  ["asubboost=wet=0:enable=1", "00".repeat(32)],
  ["asetnsamples=n=2:p=0,asetpts=PTS+4,asubboost=wet=0:enable='gte(t,0.001)'", "0080803ec0e0e02ea00f401fe02ea00f" + "00".repeat(16)],
  ["asetnsamples=n=3:p=0,asubboost=wet=0:enable=n", "0080803ec0e0e02ea00f401f" + "00".repeat(20)]
] as const) for (const graph of [false, true]) {
  it(`${filter} preserves frame boundaries and PCM (${graph ? "graph" : "simple"})`, async () => {
    const { volume, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), expected);
  });
}

for (const enable of ["", "unknown", "gte(t,)"]) {
  it(`rejects invalid asubboost enable=${enable} without replacing output`, async () => {
    const { volume, result, stderr } = await run(`asubboost=enable='${enable}'`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("asubboost enable"), stderr);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph = false, channels = [
    Float64Array.from([-32768, -8000, 4000, 12000, 16000, 12000, 8000, 4000], sample => sample / 32768),
    Float64Array.from([16000, 12000, 8000, 4000, -4000, -8000, -12000, -16000], sample => sample / 32768)
  ]) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}

for (const graph of [false, true]) it(`asubboost resumes filter history after bypass (graph=${graph})`, async () => {
  const channels = [
    Float64Array.from({ length: 1536 }, (_, i) => Math.round(12000 * Math.sin(i / 11)) / 32768),
    Float64Array.from({ length: 1536 }, (_, i) => ((i * 53) % 12000 - 6000) / 32768)
  ];
  const filter = "asubboost=boost=6:decay=0.8:delay=1";
  const actual = await run(`asetnsamples=n=256:p=0,${filter}:enable='not(mod(n,2))'`, graph, channels);
  const active = await run(filter, graph, channels.map(channel => channel.filter((_, i) => Math.floor(i / 256) % 2 === 0)));
  const original = await run("anull", graph, channels);
  for (const output of [actual, active, original]) assert.equal(output.result.exitCode, 0, output.stderr);
  const activePcm = active.volume.readFileSync("/out.pcm") as Buffer;
  const inputPcm = original.volume.readFileSync("/out.pcm") as Buffer;
  const expected = Buffer.concat(Array.from({ length: 6 }, (_, n) => n % 2 === 0
    ? activePcm.subarray(n / 2 * 1024, (n / 2 + 1) * 1024)
    : inputPcm.subarray(n * 1024, (n + 1) * 1024)));
  assert.deepEqual(actual.volume.readFileSync("/out.pcm"), expected);
});
