import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  const samples = new Float64Array(512);
  samples[128] = 24000 / 32768;
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2 PCM16 impulse hashes cover the entire resampled output.
for (const key of ["cutoff", "resample_cutoff"]) {
  for (const [value, hash] of [
    ["0.7", "76e97f62d2e7f5104bac5fba0aa9b024cecdfe16aaa529a56903dc70910b07ae"],
    ["0", "231db293e4f8c0c6a2753574c5cb5b3af0a6352ac59ccc81ea341444e24824d5"],
    ["1", "e213ea3306348bd5123f5c4b98e89def557a49d521f3c805797afd958f7e7163"]
  ]) {
    for (const graph of [false, true]) it(`aresample ${key}=${value} (${graph ? "graph" : "simple"})`, async () => {
      const result = await convert(`aresample=4000:${key}=${value}`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 512);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    });
  }
  it(`negotiates the output rate with only ${key}`, async () => {
    const result = await convert(`aresample=${key}=0.7`, false, ["-ar", "4000"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 512);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), "76e97f62d2e7f5104bac5fba0aa9b024cecdfe16aaa529a56903dc70910b07ae");
  });
  for (const value of ["", "bad", "-0.1", "1.1", "NaN", "Infinity", "0.7=1"]) {
    it(`rejects ${key}=${value} without replacing output`, async () => {
      const result = await convert(`aresample=4000:${key}=${value}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.output.toString(), "KEEP");
      assert.ok(result.stderr.includes("cutoff"), result.stderr);
    });
  }
}

// Keep intermediate samples floating point to isolate stage-local cutoff routing.
for (const [filter, options, bytes, hash] of [
  ["aresample=4000:cutoff=0.7:osf=flt,aresample=2000", [], 256, "1cd34335e6764069de57225e9042a209959dc50ff67cbb3895e31aba19ed7d4e"],
  ["aresample=4000:cutoff=0.7:osf=flt", ["-ar", "2000"], 256, "1cd34335e6764069de57225e9042a209959dc50ff67cbb3895e31aba19ed7d4e"],
  ["aresample=4000:cutoff=0.7:osf=flt", ["-ar", "2000", "-resample_cutoff", "0.5"], 256, "f07081839a1921c858659b491937e64f352fd960e17ce36383e38cb2d5e56f87"],
  ["aresample=4000:cutoff=0.7", ["-resample_cutoff", "0.5"], 512, "76e97f62d2e7f5104bac5fba0aa9b024cecdfe16aaa529a56903dc70910b07ae"],
  ["aresample=8000:cutoff=0.7", ["-ar", "4000"], 512, "231db293e4f8c0c6a2753574c5cb5b3af0a6352ac59ccc81ea341444e24824d5"],
  ["aresample=4000:cutoff=0.5:resample_cutoff=0.7", [], 512, "76e97f62d2e7f5104bac5fba0aa9b024cecdfe16aaa529a56903dc70910b07ae"],
  ["aresample=4000:cutoff=0.7:resample_cutoff=0.5", [], 512, "cb6121ae342c689895c735581a5305214cc29f01692b7fb098aacf48797eb5fd"]
] as const) {
  it(`scopes cutoff to its stage: ${filter} ${options.join(" ")}`, async () => {
    const result = await convert(filter, false, [...options]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, bytes);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}
