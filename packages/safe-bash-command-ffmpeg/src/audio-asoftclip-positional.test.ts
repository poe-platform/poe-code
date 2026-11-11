import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 s32le output for the eight PCM16 input samples below.
for (const [options, expected] of [
  ["type=hard:output=2:cubic", "000000800000008080ae1ca4c07297e8408d68178051e35bffffff7fffffff7f"],
  ["type=cubic:output=2", "000000800000008080ae1ca4c07297e8408d68178051e35bffffff7fffffff7f"],
  ["type=hard:output=2:0.5", "0000008000000080004b3aa640b5a0e8c04a5f1700b5c559ffffff7fffffff7f"],
  ["type=tanh:output=2", "0000008000000080004b3aa640b5a0e8c04a5f1700b5c559ffffff7fffffff7f"]
] as const) for (const graph of [false, true]) {
  it(`asoftclip=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const actual = await run(options, graph);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.pcm.toString("hex"), expected);
  });
}

for (const [options, control] of [
  ["output=2:cubic:0.5", "type=cubic:threshold=0.5:output=2"],
  ["cubic:output=2:0.5", "type=cubic:threshold=0.5:output=2"],
  ["type=hard:cubic:type=tanh", "type=tanh"],
  ["threshold=1:hard:0.5:output=2:0.25:2:1", "type=hard:threshold=0.5:output=0.25:param=2:oversample=1"],
  ["enable=1:output=2:cubic", "type=cubic:output=2"],
  ["type=hard:output=2:1.5", "type=cubic:output=2"],
  ["type=hard:output=2:2.5", "type=cubic:output=2"],
  ["type=hard:output=2:-0.5", "type=tanh:output=2"],
  ["type=0.5:output=2", "type=tanh:output=2"],
  ["type=hard:output=2:1/2", "type=tanh:output=2"]
] as const) for (const graph of [false, true]) {
  it(`asoftclip=${options} matches named options (${graph ? "graph" : "simple"})`, async () => {
    const actual = await run(options, graph);
    const expected = await run(control, graph);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.deepEqual(actual.pcm, expected.pcm);
  });
}

for (const [options, status] of [
  ["type=hard:output=2:unknown", 234], ["type=hard:output=2:7.1", 222],
  ["type=hard:output=2:-1.1", 222], ["type=hard:output=2:NaN", 234],
  ["type=hard:output=2:1/0", 234], ["output=2:hard:1:1:1:1:1", 8]
] as const) {
  it(`rejects invalid asoftclip=${options} without emitting PCM`, async () => {
    const actual = await run(options);
    assert.equal(actual.result.exitCode, status);
    assert.equal(actual.pcm.length, 0);
  });
}

async function run(options: string, graph = false) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from([-28000, -19000, -12000, -3000, 3000, 12000, 19000, 28000], sample => sample / 32768)
  ] }));
  const output: Buffer[] = [];
  let stderr = "";
  const filter = `asoftclip=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s32le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, pcm: Buffer.concat(output) };
}
