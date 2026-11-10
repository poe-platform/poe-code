import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
  ] }));
  const filter = `agate=${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2 SHA-256 references for the stereo PCM16 fixture above.
  for (const [expression, literal, hash] of [
    ["threshold=-12dB", "threshold=0.251188643150958", "6a0079ce72b4bb8f41ae0a9044108d428672e85437f5d0ce5c3b375861836e9a"],
    ["release=2k", "release=2000", "f5e64f104c6bbd8bfe0609011aa62e894c9e6fd99607b0dc0d5e8bda81ebbf04"],
    ["ratio=1+2*3", "ratio=7", "7e8cbdae2d6e76a06065eed2ea717dd036c7d7796d3a424abe259df00c7f5d20"],
    ["makeup=max", "makeup=64", "e8a035a84938485e25ce093e348b06ee7670b2e1e1fe76e40b91de488bb2cbce"],
    ["level_in=PI", "level_in=3.141592653589793", "9055601a206301695cfedf180e84380182cef78f2bf7d60365edff1878d56469"]
  ]) {
    it(`agate ${expression} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      for (const options of [literal!, expression!]) {
        const { result, stderr, output } = await run(options, graph);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length, 25600);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }

  for (const [expression, literal] of [
    ["range=1/4", "range=0.25"], ["attack=10m", "attack=0.01"],
    ["knee=sqrt(4)", "knee=2"], ["level_sc=E", "level_sc=2.718281828459045"],
    ["level_in=PHI", "level_in=1.618033988749895"],
    ["level_in=min:range=min:threshold=min:ratio=min:attack=min:release=min:makeup=min:knee=min:level_sc=min", "level_in=0.015625:range=0:threshold=0:ratio=1:attack=0.01:release=0.01:makeup=1:knee=1:level_sc=0.015625"],
    ["level_in=max:range=max:threshold=max:ratio=max:attack=max:release=max:makeup=max:knee=max:level_sc=max", "level_in=64:range=1:threshold=1:ratio=9000:attack=9000:release=9000:makeup=64:knee=8:level_sc=64"],
    ["level_in=2:level_in=default:range=default:threshold=default:ratio=default:attack=default:release=default:makeup=default:knee=default:level_sc=default", "level_in=1:range=0.06125:threshold=0.125:ratio=2:attack=20:release=250:makeup=1:knee=2.828427125:level_sc=1"],
    ["range=none:threshold=max/2:ratio=default+1", "range=0:threshold=0.5:ratio=3"],
    ["PI:downward:1/4:-12dB:1+2*3:20:2k:sqrt(4):default:rms:average:E", "3.141592653589793:downward:0.25:0.251188643150958:7:20:2000:2:2.828427125:rms:average:2.718281828459045"]
  ]) {
    it(`agate evaluates ${expression} (${graph ? "graph" : "simple"})`, async () => {
      const expected = await run(literal!, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      const actual = await run(expression!, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const [options, status] of [
    ["threshold=1dB", 222], ["release=10k", 222], ["ratio=1/2", 222],
    ["level_in=max+1", 222], ["makeup=min-1", 222], ["range=all", 222],
    ["attack=1/", 234], ["knee=1/0", 234], ["threshold=0/0", 234],
    ["level_sc=unknown", 234], ["level_in=0b1", 234], ["ratio=0o7", 234], ["attack=", 234]
  ] as const) {
    it(`agate rejects ${options} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(options, graph);
      assert.equal(result.exitCode, status, stderr);
      assert.ok(stderr.includes("agate:"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
