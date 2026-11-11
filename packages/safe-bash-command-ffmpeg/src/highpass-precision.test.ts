import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, 32767, 1, -3, 567, -719, 9501, 6061, -17581, 2131, 8192, -8192];
// Native FFmpeg PCM16 output; s32-to-s16 conversion discards the low bits.
const integer = "87997866fd2c01d33d234adc53348efc73ca08f023304ad5";
const floating = "87997866fe2c01d33e234adc53348dfc73ca07f0243049d5";
const int32 = "86997866fd2c00d33d2349dc53348dfc72ca07f0233049d5";
for (const graph of [false, true]) {
  for (const [precision, expected] of [["auto", integer], ["s16", integer], ["s32", int32], ["f32", floating], ["f64", floating],
    ["-1", integer], ["0", integer], ["1", int32], ["2", floating], ["3", floating], ["1+1", floating]] as const) {
    for (const key of ["precision", "r"]) it(`highpass ${key}=${precision} matches native (graph=${graph})`, async () => {
      const { fs, result, stderr } = await run(`highpass=f=400:${key}=${precision}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
  for (const precision of ["s32", "f32", "f64"]) it(`retains ${precision} samples through float64 encoding (graph=${graph})`, async () => {
    const { fs, result, stderr } = await run(`highpass=f=400:r=${precision}`, graph, "f64le");
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    const reference = [-0.8005707207322539, 0.8005462892527393, 0.35149435314454974, -0.3515324900927857,
      0.275318918694503, -0.2790030719144781, 0.40879297052379576, -0.026938396023323066,
      -0.418372205861737, -0.1247846831512365, 0.3760951335667838, -0.3337005346984542];
    for (const [index, value] of reference.entries()) {
      const actual = output.readDoubleLE(index * 8);
      if (precision === "s32") assert.equal(actual, Math.trunc(value * 2147483648) / 2147483648);
      else if (precision === "f32") {
        // Native builds may fuse multiply-adds; allow float error, but require float storage.
        assert.ok(Math.abs(actual - value) < 0.000001);
        assert.equal(actual, Math.fround(actual));
      } else assert.ok(Math.abs(actual - value) < 1e-14);
    }
  });
  for (const precision of ["", "bogus", "-2", "4", "NaN"]) it(`rejects precision=${precision} without overwriting (graph=${graph})`, async () => {
    const { fs, result } = await run(`highpass=f=400:precision=${precision}`, graph);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
  });
  for (const [filter, expected] of [
    ["highpass=f=400:precision=s16,volume=1", integer],
    ["aformat=s16p,highpass=f=400:r=f32", floating],
    ["highpass=f=400:precision=s16:r=f64", floating],
    ["highpass=f=400:r=f64:precision=s16", integer]
  ]) it(`honors explicit precision through ${filter} (graph=${graph})`, async () => {
    const { fs, result, stderr } = await run(filter!, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}

async function run(filter: string, graph: boolean, format = "s16le") {
  const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
    Float64Array.from(samples.filter((_, index) => index % 2 === channel), value => value / 32768)) });
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}
