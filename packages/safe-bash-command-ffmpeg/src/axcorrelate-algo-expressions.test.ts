import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(algo: string) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/main.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(256).fill(8000 / 32768), new Float64Array(256).fill(-4000 / 32768)
  ] }));
  fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 256 }, (_, i) => [0, 2048, 16384, 1000][Math.floor(i / 64)]! / 32768),
    new Float64Array(256)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/main.wav", "-i", "/key.wav", "-filter_complex",
      `[0:a][1:a]axcorrelate=size=128:algo=${algo}[out]`, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.wav") as Buffer };
}

// Native FFmpeg rounds integer options to nearest, with ties to even,
// after checking the unrounded value against the option range.
for (const [expression, name] of [
  ["1+1", "best"], ["1.9", "best"], ["1.5", "best"],
  ["0.5", "slow"], ["0.5001", "fast"], ["best-1", "fast"],
  ["0", "slow"], ["1", "fast"], ["2", "best"]
]) {
  it(`axcorrelate evaluates algo=${expression} like ${name}`, async () => {
    const expected = await run(name!);
    const actual = await run(expression!);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.output, expected.output);
    const other = await run(name === "fast" ? "best" : "fast");
    assert.equal(other.result.exitCode, 0, other.stderr);
    assert.notDeepEqual(actual.output, other.output);
  });
}

for (const [value, exitCode] of [
  ["unknown", 234], ["", 234], ["2.1", 222], ["-0.1", 222], ["3", 222],
  ["1/0", 234], ["0/0", 234], ["1+", 234], ["0b1", 234]
] as const) {
  it(`axcorrelate rejects algo=${value} without replacing output`, async () => {
    const { result, stderr, output } = await run(value);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.ok(stderr.includes("axcorrelate:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
