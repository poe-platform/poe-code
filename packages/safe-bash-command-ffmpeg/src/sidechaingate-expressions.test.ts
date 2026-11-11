import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(option: string) {
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
      `[0:a][1:a]sidechaingate${option ? `=${option}` : ""}[out]`, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
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

for (const [option, expression, literal] of [
  ["level_in", "1/2", "0.5"],
  ["range", "1/4", "0.25"],
  ["threshold", "1/8", "0.125"],
  ["ratio", "2*2", "4"],
  ["attack", "2+3", "5"],
  ["release", "1k/2", "500"],
  ["makeup", "sqrt(4)", "2"],
  ["knee", "2^2", "4"],
  ["level_sc", "1/2", "0.5"],
  ["mode", "1-1", "downward"],
  ["mode", "downward+1", "upward"],
  ["mode", "upward/2", "downward"],
  ["detection", "0.75", "rms"],
  ["detection", "peak+1", "rms"],
  ["detection", "rms/2", "peak"],
  ["link", "average+1", "maximum"],
  ["link", "maximum-1", "average"],
  ["link", "maximum/2", "average"],
  ...["mode", "detection", "link"].flatMap(option => [
    [option, "0.25", "0"], [option, "0.5", "0"], [option, "0.50001", "1"],
    [option, "sqrt(1)", "1"]
  ])
]) {
  it(`sidechaingate evaluates ${option}=${expression} like ${literal}`, async () => {
    const decimal = await run(`${option}=${literal}`);
    assert.equal(decimal.result.exitCode, 0, decimal.stderr);
    const evaluated = await run(`${option}=${expression}`);
    assert.equal(evaluated.result.exitCode, 0, evaluated.stderr);
    assert.deepEqual(evaluated.output, decimal.output);
    if (option === "level_sc") {
      const audio = parseWav(evaluated.output).tracks[0]!.decodedAudio!;
      // Native FFmpeg 7.0.2 PCM16 reference for this stereo program/key pair.
      assert.deepEqual([64, 128, 192, 255].map(i => audio.channelData[0]![i]! * 32768), [490, 490, 6151, 5584]);
      const defaults = await run("");
      assert.equal(defaults.result.exitCode, 0, defaults.stderr);
      assert.notDeepEqual(evaluated.output, defaults.output);
    }
  });
}

for (const [option, status] of [["level_in=0b1", 234], ["range=0b1", 234], ["level_sc=0o1", 234], ["level_sc=1/0", 234],
  ["level_sc=0/0", 234], ["level_sc=1/", 234], ["level_sc=65/1", 222], ["level_sc=1/128", 222], ["level_sc=unknown", 234],
  ...["mode", "detection", "link"].flatMap(option =>
    ["", "-0.1", "1.1", "1/0", "0/0", "unknown", "1/"].map(value => [`${option}=${value}`, 234] as const)),
  ["mode=rms", 234], ["detection=maximum", 234], ["link=upward", 234]] as const)
  it(`sidechaingate rejects ${option} without replacing output`, async () => {
    const { result, stderr, output } = await run(option);
    assert.equal(result.exitCode, status, stderr);
    assert.ok(stderr.includes("sidechaingate:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });

for (const [option, status] of [
  ["ratio=bad:ratio=2", 234], ["ratio=0:ratio=2", 222], ["ratio=9001:ratio=2", 222], ["ratio=2:ratio=0", 222],
  ["level_in=0:level_in=1", 222], ["range=2:range=0.25", 222], ["threshold=-1:threshold=0.125", 222],
  ["attack=0:attack=20", 222], ["release=9001:release=250", 222], ["makeup=0:makeup=1", 222],
  ["knee=9:knee=2", 222], ["level_sc=0:level_sc=1", 222], ["threshold=NaN:threshold=0.125", 234],
  ["attack=:attack=20", 234], ["mode=no:mode=downward", 234], ["detection=bad:detection=rms", 234],
  ["link=2:link=average", 234], ["0:level_in=1", 222], ["1:no:mode=downward", 234],
  ["mode=1.1:mode=0", 234], ["detection=-0.1:detection=1", 234], ["link=average+2:link=0", 234]
] as const) {
  it(`sidechaingate validates overridden options in ${option} without replacing output`, async () => {
    const { result, stderr, output } = await run(option);
    assert.equal(result.exitCode, status, stderr);
    assert.ok(stderr.includes("sidechaingate:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}

for (const [repeated, last] of [
  ["level_in=2:level_in=1/2", "level_in=0.5"],
  ["range=0.5:range=1/4", "range=0.25"],
  ["threshold=0.5:threshold=1/8", "threshold=0.125"],
  ["ratio=3:ratio=2", "ratio=2"],
  ["attack=10:attack=2+3", "attack=5"],
  ["release=100:release=1k/2", "release=500"],
  ["makeup=3:makeup=sqrt(4)", "makeup=2"],
  ["knee=1:knee=2^2", "knee=4"],
  ["level_sc=2:level_sc=1/2", "level_sc=0.5"],
  ["mode=upward:mode=downward", "mode=downward"],
  ["detection=rms:detection=0", "detection=peak"],
  ["link=average:link=1", "link=maximum"],
  ["2:level_in=1/2", "level_in=0.5"],
  ["1:upward:mode=downward", "mode=downward"],
  ["mode=upward:mode=1-1", "mode=downward"],
  ["detection=peak:detection=0.75", "detection=rms"],
  ["link=average:link=average+1", "link=maximum"],
  ["1:downward+1", "mode=upward"]
] as const) {
  it(`sidechaingate uses the last valid value in ${repeated}`, async () => {
    const expected = await run(last);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    const actual = await run(repeated);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.output, expected.output);
  });
}

for (const [option, min, max, defaultValue] of [
  ["level_in", 0.015625, 64, 1],
  ["range", 0, 1, 0.06125],
  ["threshold", 0, 1, 0.125],
  ["ratio", 1, 9000, 2],
  ["attack", 0.01, 9000, 20],
  ["release", 0.01, 9000, 250],
  ["makeup", 1, 64, 1],
  ["knee", 1, 8, 2.828427125],
  ["level_sc", 0.015625, 64, 1]
] as const) {
  for (const [expression, literal] of [
    ["min", min], ["max", max], ["default", defaultValue],
    ["(min+max)/2", (min + max) / 2]
  ] as const) {
    it(`sidechaingate resolves ${option}=${expression} to ${literal}`, async () => {
      const expected = await run(`${option}=${literal}`);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      const actual = await run(`${option}=${expression}`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  it(`sidechaingate restores the original ${option} default after an override`, async () => {
    const expected = await run(`${option}=${defaultValue}`);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    const actual = await run(`${option}=max:${option}=default`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.output, expected.output);
  });

  for (const [expression, status] of [["min-1", 222], ["max+1", 222], ["default/0", 234]] as const) {
    it(`sidechaingate rejects ${option}=${expression} without replacing output`, async () => {
      const { result, stderr, output } = await run(`${option}=${expression}:${option}=default`);
      assert.equal(result.exitCode, status, stderr);
      assert.ok(stderr.includes("sidechaingate:"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
