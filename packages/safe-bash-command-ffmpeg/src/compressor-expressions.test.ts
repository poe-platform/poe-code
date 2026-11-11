import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function compress(mode: string, options: string,
  samples = Float64Array.from({ length: 2048 }, (_, i) => (i % 8 < 4 ? 0.25 : -0.25))
) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
    channels: [samples] }));
  fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000,
    channels: [new Float64Array(samples.length).fill(0.5)] }));
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
    ...[
      ["level_in", 0.015625, 64, 1],
      ["threshold", 0.000976563, 1, 0.125],
      ["ratio", 1, 20, 2],
      ["attack", 0.01, 2000, 20],
      ["release", 0.01, 9000, 250],
      ["makeup", 1, 64, 1],
      ["knee", 1, 8, 2.82843],
      ["level_sc", 0.015625, 64, 1],
      ["mix", 0, 1, 1]
    ].flatMap(([key, min, max, defaultValue]) => [
      [`${key}=min`, `${key}=${min}`],
      [`${key}=max`, `${key}=${max}`],
      [`${key}=min:${key}=default`, `${key}=${defaultValue}`]
    ]),
    ["level_in=PI/4", "level_in=0.7853981633974483"],
    ["makeup=E", "makeup=2.718281828459045"],
    ["knee=PHI", "knee=1.618033988749895"],
    ["ratio=max/2", "ratio=10"],
    ["attack=default*2", "attack=40"],
    ["mix=none", "mix=0"],
    ["mix=-all", "mix=1"],
    ["PI/4:downward:default:max", "0.7853981633974483:downward:0.125:20"],
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

  for (const options of ["ratio=0b10", "ratio=0o10", "threshold=1/0", "threshold=1/", "threshold=2/1", "attack=0/1", "ratio=max+1", "ratio=min/2", "ratio=none", "mix=all", "level_in=pi", "ratio=unknown", "ratio=max+1:ratio=default"]) {
    it(`${mode} rejects ${options} without replacing output`, async () => {
      const { result, output } = await compress(mode, options);
      assert.notEqual(result.exitCode, 0);
      assert.equal(output.toString(), "KEEP");
    });
  }
}

for (const mode of ["simple", "acompressor"]) {
  it(`${mode} matches native FFmpeg PCM for level_in=PI/4`, async () => {
    const { result, output, error } = await compress(mode, "level_in=PI/4", new Float64Array(8).fill(8000 / 32768));
    assert.equal(result.exitCode, 0, error);
    const samples = parseWav(output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(samples, sample => sample * 32768), [6283, 6283, 6283, 6283, 6283, 6283, 6281, 6268]);
  });
}
