import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg integer options round to nearest, ties to even, before the odd-window rule.
for (const [fractional, integer] of [
  ["f=10.5:g=3", "f=10:g=3"],
  ["f=11.5:g=3", "f=12:g=3"],
  ["f=10.49:g=3", "f=10:g=3"],
  ["f=10.51:g=3", "f=11:g=3"],
  ["f=10:g=3.49", "f=10:g=3"],
  ["f=10:g=3.5", "f=10:g=5"],
  ["framelen=10.5:gausssize=4.5", "f=10:g=5"],
  ["11.5:5.5", "12:7"],
  ["f=7999.5:g=300.5", "f=8000:g=301"],
  ["f=8000:g=301", "framelen=8000:gausssize=301"]
]) for (const graph of [false, true]) it(`dynaudnorm=${fractional} rounds like ${integer} (${graph ? "graph" : "simple"})`, async () => {
  const fs = Volume.fromJSON({});
  const samples = Float64Array.from({ length: 8137 }, (_, i) =>
    (i % 16 < 8 ? 1 : -1) * [500, 4000, 16000, 1000][Math.floor(i / 2048)]! / 32768);
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  for (const [name, options] of [["fractional", fractional], ["integer", integer]]) {
    const filter = `dynaudnorm=${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", `/${name}.pcm`],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
  }
  assert.equal(fs.statSync("/fractional.pcm").size, samples.length * 2);
  assert.deepEqual(fs.readFileSync("/fractional.pcm"), fs.readFileSync("/integer.pcm"));
});

for (const options of ["f=9.9", "framelen=8000.1", "g=2.9", "gausssize=301.1"]) {
  for (const graph of [false, true]) it(`dynaudnorm=${options} checks the range before rounding (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const filter = `dynaudnorm=${options}`;
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
