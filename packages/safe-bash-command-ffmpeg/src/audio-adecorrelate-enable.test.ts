import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = [
  Float64Array.from({ length: 32 }, (_, i) => ((i * 1237) % 30001 - 15000) / 32768),
  Float64Array.from({ length: 32 }, (_, i) => (10000 - (i * 937) % 20001) / 32768)
];

async function run(filter: string, graph: boolean, channels = input) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 48000, channels }));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stderr, bytes: Buffer.concat(chunks) };
}

for (const graph of [false, true]) {
  // Complete PCM SHA-256 references from native FFmpeg 7.0.2.
  for (const [suffix, hash] of [
    [":enable=0", "790d5eb4b0a43f0c07ed8b50e5ce82d841604be5d004bcb97fc51d0ebb467358"],
    [":enable='gte(n,2)'", "a420db3c96026551d1e61f5594eaa07dd0fe2f4ea0f11f979daaf1539aece901"],
    ["", "433ffd7a01407d8506006121a780762fc05dbd08fa0592d6004405683e7d28d3"],
    [":enable=1", "433ffd7a01407d8506006121a780762fc05dbd08fa0592d6004405683e7d28d3"],
    [":enable='gte(t,16/48000)'", "a420db3c96026551d1e61f5594eaa07dd0fe2f4ea0f11f979daaf1539aece901"]
  ]) {
    it(`adecorrelate${suffix} matches complete native PCM (graph=${graph})`, async () => {
      const result = await run(`asetnsamples=n=8:p=0,adecorrelate=seed=42${suffix}`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.bytes.length, 128);
      assert.equal(createHash("sha256").update(result.bytes).digest("hex"), hash);
    });
  }

  it(`adecorrelate freezes all stages through bypass and resumes on a partial frame (graph=${graph})`, async () => {
    const channels = input.map(channel => Float64Array.from({ length: 509 }, (_, i) => channel[i % channel.length]!));
    const enabled = channels.map(channel => Float64Array.from([...channel.slice(128, 256), ...channel.slice(384)]));
    const filtered = await run("adecorrelate=seed=42", graph, enabled);
    const bypass = await run("anull", graph, channels);
    const actual = await run("asetnsamples=128:0,adecorrelate=seed=42:enable='mod(n,2)'", graph, channels);
    for (const result of [filtered, bypass, actual]) assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(actual.bytes, Buffer.concat([
      bypass.bytes.subarray(0, 512), filtered.bytes.subarray(0, 512),
      bypass.bytes.subarray(1024, 1536), filtered.bytes.subarray(512)
    ]));
  });

  for (const [prefix, enable] of [
    ["asetnsamples=8:0,asetpts=PTS+48000,", "gte(t,1+16/48000)"],
    ["asetnsamples=8:0,", "gt(st(0,ld(0)+1),4)"]
  ]) {
    it(`adecorrelate preserves shifted timestamps and frame expression state: ${enable} (graph=${graph})`, async () => {
      const result = await run(`${prefix}adecorrelate=seed=42:enable='${enable}'`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.bytes.length, 128);
      assert.equal(createHash("sha256").update(result.bytes).digest("hex"),
        "a420db3c96026551d1e61f5594eaa07dd0fe2f4ea0f11f979daaf1539aece901");
    });
  }

  for (const enable of ["0", "0.25", "gte(n,1)"]) {
    it(`adecorrelate bypasses a decoder frame with enable=${enable} (graph=${graph})`, async () => {
      const result = await run(`adecorrelate=seed=42:enable='${enable}'`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.bytes.length, 128);
      assert.equal(createHash("sha256").update(result.bytes).digest("hex"),
        "790d5eb4b0a43f0c07ed8b50e5ce82d841604be5d004bcb97fc51d0ebb467358");
    });
  }

  for (const enable of ["", "unknown", "gte(n)", "1+"]) {
    it(`adecorrelate rejects invalid enable=${enable} without emitting PCM (graph=${graph})`, async () => {
      const result = await run(`adecorrelate=seed=42:enable=${enable}`, graph);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("adecorrelate"), result.stderr);
      assert.equal(result.bytes.length, 0);
    });
  }
}
