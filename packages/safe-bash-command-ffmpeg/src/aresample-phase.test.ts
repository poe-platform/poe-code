import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  const samples = new Float64Array(96);
  samples[30] = 25000 / 32768;
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

// Native FFmpeg 7.0.2, 96 mono PCM16 samples at 8 kHz, impulse 25000 at sample 30.
for (const graph of [false, true]) {
  for (const [filter, count, hash] of [
    ["11025", 133, "d48f6cb3bb320f58bb91e85292286b45eb6ca0a820a873a49fedc2cfc819640a"],
    ["11025:phase_shift=2", 133, "52a53cdb05725d4be4e7db0793a349b09e349cbb06b232370dd72c8fbcbb1125"],
    ["11025:phase_shift=2:linear_interp=0", 133, "6922fd4ce4bf1c654e91b38430a3a79fce5b36f8c2dc18868d4f3f73dfe3a8bf"],
    ["11025:linear_interp=0", 133, "d48f6cb3bb320f58bb91e85292286b45eb6ca0a820a873a49fedc2cfc819640a"],
    ["10000:exact_rational=0", 120, "ba637578735752ffbb489f41f54deadf62d7ba73d960f1ed6c3a1aae6a1941af"],
    ["10000:phase_shift=3:exact_rational=1", 120, "ba637578735752ffbb489f41f54deadf62d7ba73d960f1ed6c3a1aae6a1941af"],
    ["10000:phase_shift=3:exact_rational=0", 120, "21f192d12cee1297b703567e8bf5ca8f0c85a9c9b0bf4aac18189a6cdd7183a6"]
  ] as const) {
    it(`matches native aresample=${filter} (${graph ? "graph" : "simple"})`, async () => {
      const result = await convert(`aresample=${filter}`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, count * 2);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
    });
  }
}

for (const [key, values] of [
  ["phase_shift", [0, 24]], ["linear_interp", [0, 1]], ["exact_rational", [0, 1]]
] as const) {
  for (const value of values) {
    it(`negotiates the output rate with ${key}=${value} alone`, async () => {
      const expected = await convert("anull", false, ["-ar", "11025", `-${key}`, String(value)]);
      const result = await convert(`aresample=${key}=${value}`, false, ["-ar", "11025"]);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected.output);
    });
  }
}

for (const graph of [false, true]) {
  for (const filter of [
    "aresample=11025:phase_shift=2:phase_shift=10:linear_interp=0:linear_interp=1:exact_rational=0:exact_rational=1:",
    "aresample=8000:phase_shift=0:linear_interp=0:exact_rational=0,aresample=11025"
  ]) {
    it(`keeps phase options local and honors the last value: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const expected = await convert("aresample=11025", graph);
      const result = await convert(filter, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected.output);
    });
  }
}

it("keeps explicit phase options independent from output resampler options", async () => {
  const expected = await convert("aresample=11025:phase_shift=2:linear_interp=0:exact_rational=0");
  const result = await convert("aresample=11025:phase_shift=2:linear_interp=0:exact_rational=0", false,
    ["-phase_shift", "0", "-linear_interp", "1", "-exact_rational", "1"]);
  assert.equal(expected.exitCode, 0, expected.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected.output);
});

it("does not leak explicit phase options into the output resampler", async () => {
  const expected = await convert("anull", false, ["-ar", "11025"]);
  const result = await convert("aresample=8000:phase_shift=0:linear_interp=0:exact_rational=0", false, ["-ar", "11025"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected.output);
});

for (const key of ["phase_shift", "linear_interp", "exact_rational"]) {
  for (const value of ["", "-1", "1.5", "NaN", "Infinity", "1=0", key === "phase_shift" ? "25" : "2"]) {
    it(`rejects invalid ${key}=${value} without replacing output`, async () => {
      const result = await convert(`aresample=11025:${key}=${value}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.output.toString(), "KEEP");
      assert.ok(result.stderr.includes(`${key} must be`), result.stderr);
      assert.ok(!result.stderr.includes("first_pts"), result.stderr);
    });
  }
}
