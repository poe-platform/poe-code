import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { shiftAudioPhase } from "./audio-aphaseshift.js";

// Native FFmpeg 7.0.2, 4000 mono PCM16 samples at 8 kHz, 500 Hz sine.
const references = [
  [0, 4776, 11009, [11008, 11999, 11162, 8626, 4776, 200, -4407, -8343, -11008, -11999, -11162, -8626, -4776, -200, 4407, 8343]],
  [0.5, -11008, 4777, [4776, 200, -4407, -8343, -11010, -11999, -11162, -8626, -4777, -201, 4406, 8342, 11008, 11998, 11161, 8625]],
  [-0.5, 11008, -4777, [-4776, -200, 4407, 8343, 11010, 11999, 11162, 8626, 4777, 201, -4406, -8342, -11008, -11998, -11161, -8625]],
  [1, -4776, -11009, [-11008, -11999, -11162, -8626, -4776, -200, 4407, 8343, 11008, 11999, 11162, 8626, 4776, 200, -4407, -8343]]
] as const;

for (const [shift, sine, cosine, samples] of references) {
  for (const graph of [false, true]) {
    it(`aphaseshift=${shift} matches native phase without changing frequency (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(`aphaseshift=shift=${shift}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, 8000);
      for (let i = 0; i < samples.length; i++) {
        assert.ok(Math.abs(pcm.readInt16LE((2400 + i) * 2) - samples[i]!) <= 2, `sample ${i}`);
      }
      for (const frequency of [250, 500, 750]) {
        let actualSine = 0, actualCosine = 0;
        for (let frame = 2400; frame < 4000; frame++) {
          const angle = 2 * Math.PI * frequency * frame / 8000;
          actualSine += pcm.readInt16LE(frame * 2) * Math.sin(angle) / 800;
          actualCosine += pcm.readInt16LE(frame * 2) * Math.cos(angle) / 800;
        }
        assert.ok(Math.abs(actualSine - (frequency === 500 ? sine : 0)) <= 2, `${frequency} Hz sine: ${actualSine}`);
        assert.ok(Math.abs(actualCosine - (frequency === 500 ? cosine : 0)) <= 2, `${frequency} Hz cosine: ${actualCosine}`);
      }
    });
  }
}

it("anull preserves the input tone", async () => {
  const { volume, result, stderr } = await run("anull");
  assert.equal(result.exitCode, 0, stderr);
  const pcm = volume.readFileSync("/out.raw") as Buffer;
  for (let i = 0; i < 4000; i++) assert.equal(pcm.readInt16LE(i * 2), Math.round(12000 * Math.sin(2 * Math.PI * 500 * i / 8000)) || 0);
});

for (const option of ["shift=1.1", "shift=-1.1", "shift=NaN", "shift=", "level=-1", "level=1.1", "order=0", "order=17", "order=0.9", "order=16.1", "order=NaN", "order=Infinity", "order=", "unknown=1"]) {
  it(`aphaseshift=${option} fails without replacing output`, async () => {
    const { volume, result, stderr } = await run(`aphaseshift=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("aphaseshift:"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

// Native FFmpeg 7.0.2, 8192 mono PCM16 samples at 8 kHz.
for (const [order, hash] of [
  [2, "8f70f25ad89ee294c1b34d445c31ee0ee851f15ee810f77fe5bd7e808c9a53d3"],
  [2.5, "8f70f25ad89ee294c1b34d445c31ee0ee851f15ee810f77fe5bd7e808c9a53d3"],
  [3.5, "3da69c2c4dc954be96e615e7e21d7b9ddde709f5ff93018164abf139b9431bc7"],
  [4, "3da69c2c4dc954be96e615e7e21d7b9ddde709f5ff93018164abf139b9431bc7"]
] as const) {
  for (const options of [`order=${order}`, `0:1:${order}`]) {
    for (const graph of [false, true]) {
      it(`aphaseshift=${options} matches native order rounding (${graph ? "graph" : "simple"})`, async () => {
        const { volume, result, stderr } = await run(`aphaseshift=${options}`, graph, 8000, false, 8192);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 16384);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      });
    }
  }
}

for (const [fractional, integer] of [[1.5, 2], [2.4, 2], [2.6, 3], [15.5, 16]]) {
  it(`rounds aphaseshift order ${fractional} to ${integer}`, async () => {
    const actual = await run(`aphaseshift=order=${fractional}`);
    const expected = await run(`aphaseshift=order=${integer}`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.deepEqual(actual.volume.readFileSync("/out.raw"), expected.volume.readFileSync("/out.raw"));
  });
}

// Native FFmpeg 7.0.2 stereo PCM16 samples at startup and frame 2400.
for (const [sampleRate, filter, start, tail] of [
  [8000, "aphaseshift", [0, 12, 6, 10, 11, -525, -255, -443, -483, 3260, 1133, 2978, 2578, -4443, 500, -5265],
    [11008, 6453, 11999, 8851, 11162, 8265, 8626, 4894, 4776, -127, 200, -5106, -4407, -8363, -8343, -8801]],
  [48000, "aphaseshift=0.25:0.5:1", [0, 2571, 224, -589, 173, -1716, 25, -1659, -118, -2545, -338, -2453, -550, -3124, -824, -2982],
    [3377, 3421, 2969, 3712, 2549, 3968, 2117, 4185, 1677, 4361, 1229, 4497, 776, 4588, 320, 4636]],
  [44100, "aphaseshift=-1:1:16", [0, 0, 0, 0, 0, 28, 3, 28, 5, -421, -35, -419, -74, 2065, 121, 2062],
    [5565, -7869, 4799, -7350, 4008, -6761, 3195, -6082, 2367, -5346, 1524, -4535, 674, -3688, -181, -2784]]
] as const) {
  it(`${filter} matches native stereo transients and independent channel state at ${sampleRate} Hz`, async () => {
    const { volume, result, stderr } = await run(filter, false, sampleRate, true);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, 16000);
    for (const [frame, expected] of [[0, start], [2400, tail]] as const) {
      for (let i = 0; i < expected.length; i++) {
        const actual = pcm.readInt16LE(frame * 4 + i * 2);
        assert.ok(Math.abs(actual - expected[i]!) <= 2, `sample ${frame * 2 + i}: ${actual} vs ${expected[i]}`);
      }
    }
  });
}

it("bounds phase-shift memory and honors cancellation", async () => {
  const channels = [new Float32Array(4000)];
  await assert.rejects(shiftAudioPhase(channels, 8000, "aphaseshift", "fltp",
    new MediaBudgetTracker({ maxMemoryBytes: 128 })), /maxMemoryBytes/);
  await assert.rejects(shiftAudioPhase(channels, 8000, "aphaseshift", "fltp",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, sampleRate = 8000, stereo = false, frames = 4000) {
  const channels = [Float64Array.from({ length: frames }, (_, i) => Math.round(12000 * Math.sin(2 * Math.PI * 500 * i / sampleRate)) / 32768)];
  if (stereo) channels.push(Float64Array.from({ length: frames }, (_, i) => Math.round(9000 * Math.cos(2 * Math.PI * 750 * i / sampleRate)) / 32768));
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/tone.wav", encodeWav({ sampleRate, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/tone.wav", ...(graph
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
  return { volume, result, stderr };
}
