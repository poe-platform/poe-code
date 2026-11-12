import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
  [12000, -1000, 0, 0, 1000, 2000, -5000, 9000, 0, -12000, 15000, 0], value => value / 32768
)] });

// Complete PCM16 output from native FFmpeg 7.0.2 for the input above.
const onePole = [3897, 2306, 1557, 1051, 1034, 1348, -713, 2441, 1648, -2784, 2991, 2019];
const twoPoles = [359, 1211, 1855, 1972, 1833, 1653, 1352, 1047, 1136, 961, 475, 679];
const octaveWidth = [2186, 2710, 11, -1526, -1844, -1106, -1384, 146, 1984, -1292, -239, 2691];

for (const [filter, expected] of [
  ["lowpass=f=500:p=1", onePole],
  ["lowpass=f=500:p=1.25", onePole],
  ["lowpass=f=500:poles=1.5", twoPoles],
  ["lowpass=f=500:p=2", twoPoles],
  ["bandpass=f=800:t=2.5:w=1", octaveWidth],
  ["bandpass=f=800:width_type=1.5:w=1", octaveWidth],
  ["bandpass=f=800:t=o:w=1", octaveWidth]
] as const) {
  for (const graph of [false, true]) it(`matches native fractional selectors: ${filter}, graph=${graph}`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const filter of ["lowpass=f=800", "highpass=f=800", "bandpass=f=800", "bandreject=f=800", "equalizer=f=800:g=6", "bass=f=800:g=6", "lowshelf=f=800:g=6", "treble=f=800:g=6", "highshelf=f=800:g=6"]) {
  it(`rounds width selectors to nearest with ties to even for ${filter}`, async () => {
    for (const [fraction, selector] of [[1.25, "h"], [1.75, "o"], [2.5, "o"], [2.75, "q"], [3.5, "s"], [4.5, "s"], [4.75, "k"]] as const) {
      const actual = await run(`${filter}:t=${fraction}:w=1`);
      const expected = await run(`${filter}:width_type=${selector}:w=1`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output, `${filter}: ${fraction} selects ${selector}`);
    }
  });
}

for (const filter of ["lowpass=f=500", "highpass=f=500", "bass=f=500:g=6", "lowshelf=f=500:g=6", "treble=f=500:g=6", "highshelf=f=500:g=6"]) {
  it(`rounds fractional poles for ${filter}`, async () => {
    for (const [fraction, poles] of [[1.25, 1], [1.5, 2], [1.75, 2]]) {
      const actual = await run(`${filter}:p=${fraction}`);
      const expected = await run(`${filter}:poles=${poles}`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
    }
  });
}

for (const option of ["p=0.9", "poles=2.1", "t=0.9", "width_type=5.1", "p=NaN", "t=Infinity"]) {
  it(`rejects ${option} before rounding without replacing output`, async () => {
    const { fs, result, output } = await run(`lowpass=${option}`, false, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.length, 0);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph = false, destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-hide_banner", "-loglevel", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr, output: Buffer.concat(chunks) };
}
