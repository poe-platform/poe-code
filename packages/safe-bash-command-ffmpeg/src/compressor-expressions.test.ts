import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function compress(mode: string, options: string) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 2048 }, (_, i) => (i % 8 < 4 ? 0.25 : -0.25))] }));
  fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000,
    channels: [new Float64Array(2048).fill(0.5)] }));
  const sidechain = mode === "sidechaincompress";
  const filter = `${sidechain ? mode : "acompressor"}=${options}`;
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", ...(sidechain ? ["-i", "/key.wav"] : []),
      ...(mode === "simple" ? ["-af", filter]
        : ["-filter_complex", `[0:a]${sidechain ? "[1:a]" : ""}${filter}[o]`, "-map", "[o]"]),
      "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, output: fs.readFileSync("/out.wav"), error: Buffer.concat(errors).toString() };
}

for (const mode of ["simple", "acompressor", "sidechaincompress"]) {
  for (const [expression, decimal] of [
    ["threshold=1/4", "threshold=0.25"],
    ["level_in=1/2", "level_in=0.5"],
    ["ratio=2*2", "ratio=4"],
    ["attack=1e2/2", "attack=50"],
    ["release=1k/2", "release=500"],
    ["makeup=sqrt(4)", "makeup=2"],
    ["knee=2^2", "knee=4"],
    ["level_sc=1+1", "level_sc=2"],
    ["mix=1/2", "mix=0.5"],
    ["1/2:downward:1/4:2*2", "0.5:downward:0.25:4"]
  ]) {
    it(`${mode} evaluates ${expression} like ${decimal}`, async () => {
      const expected = await compress(mode, decimal!);
      assert.equal(expected.result.exitCode, 0, expected.error);
      const actual = await compress(mode, expression!);
      assert.equal(actual.result.exitCode, 0, actual.error);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const options of ["ratio=0b10", "ratio=0o10", "threshold=1/0", "threshold=1/", "threshold=2/1", "attack=0/1"]) {
    it(`${mode} rejects ${options} without replacing output`, async () => {
      const { result, output } = await compress(mode, options);
      assert.notEqual(result.exitCode, 0);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
