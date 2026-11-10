import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { applyAudioGate } from "./audio-agate.js";
import { createFfmpegCommand } from "./index.js";

for (const detection of ["peak", "rms"]) {
  it(`upward zero-threshold ${detection} gating preserves initial silence, then produces NaN`, async () => {
    const [output] = await applyAudioGate([new Float64Array([0, 0, 0.25, 0, -0.5])], 8000,
      `agate=mode=upward:threshold=0:detection=${detection}`, [{ start: 0, end: 5, pts: 0 }], new MediaBudgetTracker());
    assert.deepEqual(Array.from(output!), [0, 0, NaN, NaN, NaN]);
  });
}

// Native FFmpeg 7.0.2 f32le references for the stereo PCM16 regression input.
for (const [filter, nanCount, hash] of [
  ["agate=mode=upward:threshold=0", 12800, "04b20705e1c5d1f0252b92fa8b8eb8e9a54a606df9b27ea3a246fafa70241fd3"],
  ["agate=mode=upward:threshold=0:detection=peak", 12800, "04b20705e1c5d1f0252b92fa8b8eb8e9a54a606df9b27ea3a246fafa70241fd3"],
  ["agate=mode=upward:threshold=0.00000001", 0, "4f9483a54be5f12ff6b5631b0e6ff4fe6e02e43ec750aaa231a1f197e7b2c1af"],
  ["agate=mode=downward:threshold=0", 0, "450a4705f1c187a40d8511eba999057d6570df666251b11915c886f600198bce"]
] as const) for (const graph of [false, true]) {
  it(`${filter} preserves native nonfinite samples (${graph ? "graph" : "simple"})`, async () => {
    const fs = createMemoryFileSystem();
    const channels = [
      Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
      Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
    ];
    await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: 16 }));
    await fs.writeFile("/out.raw", Buffer.from("KEEP"));
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments(["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "f32le", "/out.raw"]);
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    });
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = Buffer.from(await fs.readFile("/out.raw"));
    assert.equal(output.length, 51200);
    const samples = Array.from({ length: output.length / 4 }, (_, i) => output.readFloatLE(i * 4));
    assert.equal(samples.filter(Number.isNaN).length, nanCount);
    assert.equal(samples.filter(sample => sample === Infinity || sample === -Infinity).length, 0);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
