import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { shiftAudioPhase } from "./audio-aphaseshift.js";

async function shift(filter: string, complex = false, frequencies = [500]) {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  fs.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000,
    channels: frequencies.map(frequency => Float64Array.from({ length: 4000 }, (_, i) =>
      Math.round(12000 * Math.sin(2 * Math.PI * frequency * i / 8000)) / 32768)) }));
  let stderr = "";
  const filters = complex
    ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/tone.wav", ...filters, "-f", "s16le", "/out.raw"],
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

function amplitude(output: Buffer, frequency: number, channel = 0, channels = 1) {
  let sine = 0;
  let cosine = 0;
  for (let i = 2400; i < 4000; i++) {
    const sample = output.readInt16LE((i * channels + channel) * 2);
    sine += sample * Math.sin(2 * Math.PI * frequency * i / 8000);
    cosine += sample * Math.cos(2 * Math.PI * frequency * i / 8000);
  }
  return Math.hypot(sine, cosine) / 800;
}

// FFmpeg 7.0.2 PCM16 reference samples, beginning at frame 2400.
for (const [filter, frequency, level, samples] of [
  ["anull", 500, 1, [0, 4592, 8485, 11087, 12000, 11087, 8485, 4592, 0, -4592, -8485, -11087, -12000, -11087, -8485, -4592]],
  ["afreqshift", 500, 1, [11008, 11999, 11162, 8626, 4776, 200, -4407, -8343, -11008, -11999, -11162, -8626, -4776, -200, 4407, 8343]],
  ["afreqshift=shift=0", 500, 1, [11008, 11999, 11162, 8626, 4776, 200, -4407, -8343, -11008, -11999, -11162, -8626, -4776, -200, 4407, 8343]],
  ["afreqshift=shift=250", 750, 1, [11008, 11807, 8625, 2537, -4408, -9865, -11999, -10088, -4777, 2144, 8342, 11729, 11162, 6832, 200, -6500]],
  ["afreqshift=shift=-250", 250, 1, [11008, 11729, 11999, 11808, 11162, 10088, 8626, 6833, 4777, 2538, 201, -2144, -4407, -6499, -8342, -9865]],
  ["afreqshift=shift=250:level=0.5", 750, 0.5, [5504, 5904, 4313, 1269, -2204, -4933, -5999, -5044, -2389, 1072, 4171, 5864, 5581, 3416, 100, -3250]],
  ["afreqshift=250:0.5:8", 750, 0.5, [5504, 5904, 4313, 1269, -2204, -4933, -5999, -5044, -2389, 1072, 4171, 5864, 5581, 3416, 100, -3250]]
] as const) {
  for (const complex of [false, true]) {
    it(`shifts PCM frequencies (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const { result, stderr, output } = await shift(filter, complex);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 8000);
      samples.forEach((sample, i) => assert.ok(Math.abs(output.readInt16LE((2400 + i) * 2) - sample) <= 2,
        `sample ${i}: expected ${sample}, got ${output.readInt16LE((2400 + i) * 2)}`));
      for (const component of [250, 500, 750]) {
        const expected = component === frequency ? 12000 * level : 0;
        assert.ok(Math.abs(amplitude(output, component) - expected) < 1, `component ${component}`);
      }
    });
  }
}

it("shifts each stereo channel independently and retains filter chain gain", async () => {
  const { result, stderr, output } = await shift("volume=0.5,afreqshift=250,volume=0.5", true, [500, 1000]);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output.length, 16000);
  for (const [channel, frequency] of [750, 1250].entries()) {
    assert.ok(Math.abs(amplitude(output, frequency, channel, 2) - 3000) < 1);
    assert.ok(amplitude(output, channel === 0 ? 1250 : 750, channel, 2) < 1);
  }
});

for (const options of ["shift=NaN", "shift=2147483648", "shift=-2147483648", "shift=", "level=-0.1", "level=1.1", "order=0", "order=17", "unknown=1", "1:1:8:1"]) {
  it(`rejects invalid afreqshift options without replacing output: ${options}`, async () => {
    const { result, output } = await shift(`afreqshift=${options}`);
    assert.equal(result.exitCode, 1);
    assert.equal(output.toString(), "KEEP");
  });
}

// Native FFmpeg 7.0.2 startup and steady-state samples for nondefault orders.
for (const [order, startup, steady] of [[1, [0, 2908, 3378, -792, -5269, -9564, -10458, -8087, -2294, 4796, 11223, 14735, 14253, 9860, 2941, -4254], [9820, 11248, 8739, 3252, -3254, -8474, -10548, -8685, -3437, 3486, 9789, 13366, 13007, 8805, 2131, -4833]], [4, [0, 209, -29, -2680, -2048, 1946, 4875, 6614, 4387, 295, -5476, -9526, -11217, -8694, -3418, 3847], [-7668, -11500, -11452, -7544, -1091, 5729, 10619, 11928, 9215, 3393, -3575, -9341, -11962, -10555, -5594, 1249]], [16, [0, 0, 0, -1, 2, 20, -51, -179, 388, 726, -1202, -1578, 1052, 1939, 1687, -353], [10380, 5284, -1594, -7936, -11604, -11362, -7294, -769, 6012, 10765, 11886, 8998, 3075, -3886, -9539, -11978]]] as const) {
  it(`matches native afreqshift filter order ${order}`, async () => {
    const { result, stderr, output } = await shift(`afreqshift=shift=250:order=${order}`);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 8000);
    for (const [offset, samples] of [[0, startup], [2400, steady]] as const) {
      samples.forEach((sample, i) => assert.ok(Math.abs(output.readInt16LE((offset + i) * 2) - sample) <= 2));
    }
  });
}

it("honors frequency shift memory and CPU limits and cancellation", async () => {
  const input = [new Float32Array(4000)];
  await assert.rejects(shiftAudioPhase(input, 8000, "afreqshift", "fltp", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(shiftAudioPhase(input, 8000, "afreqshift", "fltp", new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  await assert.rejects(shiftAudioPhase(input, 8000, "afreqshift", "fltp", new MediaBudgetTracker(), AbortSignal.abort()));
});

for (const [fractional, integer] of [[2.5, 2], [3.5, 4]]) {
  it(`rounds afreqshift order ${fractional} to the nearest even integer`, async () => {
    const actual = await shift(`afreqshift=250:1:${fractional}`);
    const expected = await shift(`afreqshift=250:1:${integer}`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.deepEqual(actual.output, expected.output);
  });
}
