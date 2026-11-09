import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [positional, named] of [
  ["1", "level_in=1"],
  ["1:1:0:0.5", "amount=0.5"],
  ["0.5:2:sine:0.6:0.25:0.75", "level_in=0.5:level_out=2:mode=sine:amount=0.6:offset_l=0.25:offset_r=0.75"],
  ["1:1:1:0.6", "mode=triangle:amount=0.6"],
  ["1:1:2:0.6", "mode=square:amount=0.6"],
  ["1:1:3:0.6", "mode=sawup:amount=0.6"],
  ["1:1:4:0.6", "mode=sawdown:amount=0.6"],
  ["1:1:0:amount=0.5:hz=7", "amount=0.5:hz=7"],
  ["1:1:0:0.5:0.25:0.75:0.5:2:120:500:7", "amount=0.5:offset_l=0.25:offset_r=0.75:width=0.5:timing=hz:hz=7"],
  ["1:1:0:0.5:0:0.5:1:0:180", "amount=0.5:timing=bpm:bpm=180"],
  ["1:1:0:0.5:0:0.5:1:1:120:250", "amount=0.5:timing=ms:ms=250"]
] as const) {
  for (const graph of [false, true]) {
    it(`apulsator=${positional} matches named PCM (${graph ? "graph" : "simple"})`, async () => {
      const expected = await run(named, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      const actual = await run(positional, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(actual.bytes.length, 8192);
      assert.deepEqual(actual.bytes, expected.bytes);
    });
  }
}

for (const options of ["0:1:0:0.5", "1:65:0:0.5", "1:1:5:0.5", "1:1::0.5", "1:1:0:2", "1:1:0:0.5:0:0.5:1:2:120:500:7:1"]) {
  it(`apulsator=${options} rejects invalid positional options without replacing output`, async () => {
    const { result, bytes } = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.equal(bytes.toString(), "keep");
  });
}

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
  ] }));
  let stderr = "";
  const filter = `apulsator=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, bytes: volume.readFileSync("/out.raw") as Buffer };
}
