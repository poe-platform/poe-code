import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 13 }, (_, i) => [(i + 1) * 1901, -(i + 1) * 2203]);
const desired = input.map((_, i) => [input[i - 2]?.[0] ?? 0, input[i - 5]?.[1] ?? 0]);
// Native FFmpeg 7.0.2, stereo PCM16 at 8 kHz, four taps and default adaptation options.
const expected = {
  i: input,
  d: desired,
  o: [[0, 0], [0, 0], [1901, 0], [3714, 0], [5277, 0], [6409, -2203], [7004, -3969],
    [7063, -5165], [6686, -5793], [6016, -5947], [5197, -5760], [4346, -5362], [3544, -4860]],
  e: [[0, 0], [0, 0], [0, 0], [88, 0], [426, 0], [1195, 0], [2501, -437],
    [4343, -1444], [6621, -3019], [9192, -5068], [11912, -7458], [14664, -10059], [17367, -12764]],
};

async function run(filter: string, prefix = "[0:a]asplit[a][b];[a]anull[x];[b]adelay=2S|5S[y];[x][y]",
  limits = {}) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [0, 1].map(c => Float64Array.from(input, frame => frame[c]! / 32768)) }));
  let error = "";
  const result = await createFfmpegCommand({ limits }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-filter_complex", `${prefix}${filter}[out]`,
      "-map", "[out]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { error += new TextDecoder().decode(bytes); } }
  } as never);
  const bytes = volume.readFileSync("/out.pcm") as Buffer;
  return { result, error, bytes, frames: Array.from({ length: bytes.length / 4 }, (_, i) =>
    [bytes.readInt16LE(i * 4), bytes.readInt16LE(i * 4 + 2)]) };
}

for (const mode of ["i", "d", "o", "e"] as const) {
  it(`anlms processes both split branches in output mode ${mode}`, async () => {
    const { result, error, frames } = await run(`anlms=order=4:out_mode=${mode}`);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(frames, expected[mode]);
  });
}

it("amultiply preserves the same split and delayed reference control", async () => {
  const { result, error, frames } = await run("amultiply");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(frames, [[0, 0], [0, 0], [331, 0], [882, 0], [1654, 0], [2647, 889],
    [3860, 2074], [5294, 3555], [6948, 5332], [8823, 7405], [10918, 9775], [13234, 12441], [15771, 15403]]);
});

it("anlms accepts positional options and named instances, and defaults to residual output", async () => {
  for (const filter of ["anlms=4", "anlms@adaptive=4:0.75:1:0:o", "anlms=order=2+2:out_mode=2:"]) {
    const { result, error, frames } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(frames, expected.o);
  }
});

it("anlms applies filters on both branches and following filters", async () => {
  const { result, error, frames } = await run("anlms=4:out_mode=i,volume=0.5",
    "[0:a]asplit[a][b];[a]volume=2[x];[b]adelay=2S|5S[y];[x][y]");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(frames, input);
});

for (const branch of [0, 1]) {
  it(`anlms stops when branch ${branch} ends`, async () => {
    const graph = `[0:a]asplit[a][b];[a]${branch === 0 ? "atrim=end_sample=7" : "anull"}[x];` +
      `[b]adelay=2S|5S${branch === 1 ? ",atrim=end_sample=7" : ""}[y];[x][y]`;
    const { result, error, frames } = await run("anlms=4:out_mode=e", graph);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(frames, expected.e.slice(0, 7));
  });
}

it("anlms with zero adaptation passes the desired signal in residual mode", async () => {
  const { result, error, frames } = await run("anlms=4:mu=0");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(frames, desired);
});

for (const options of ["order=0", "order=32768", "mu=-1", "mu=3", "eps=2", "leakage=-1", "out_mode=5", "precision=3", "unknown=1"]) {
  it(`anlms rejects ${options} without replacing output`, async () => {
    const { result, error, bytes } = await run(`anlms=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(error.includes("anlms"), error);
    assert.equal(bytes.toString(), "keep");
  });
}

it("anlms rejects extra connected inputs without replacing output", async () => {
  const { result, error, bytes } = await run("anlms=4", "[0:a]asplit=3[a][b][c];[a][b][c]");
  assert.notEqual(result.exitCode, 0);
  assert.ok(error.includes("anlms requires two inputs"), error);
  assert.equal(bytes.toString(), "keep");
});

it("anlms bounds its adaptive state before replacing output", async () => {
  const { result, error, bytes } = await run("anlms=order=32767", undefined, { maxMemoryBytes: 100000 });
  assert.notEqual(result.exitCode, 0);
  assert.ok(error.includes("maxMemoryBytes"), error);
  assert.equal(bytes.toString(), "keep");
});

for (const [options, expectedFrames] of [
  ["4:out_mode=n", [[1901, -2203], [3802, -4406], [5703, -6609], [7516, -8812], [9079, -11015],
    [10211, -13218], [10806, -14984], [10865, -16180], [10488, -16808], [9818, -16962],
    [8999, -16775], [8148, -16377], [7346, -15875]]],
  ["4:mu=1:eps=0.5:leakage=0.1", [[0, 0], [0, 0], [1901, 0], [3587, 0], [4763, 0], [5289, -2203],
    [5285, -3595], [5010, -4286], [4690, -4542], [4455, -4605], [4345, -4624], [4351, -4671], [4449, -4770]]],
  ["1", [[0, 0], [0, 0], [1901, 0], [3748, 0], [5464, 0], [6963, -2203], [8163, -4169],
    [9005, -5790], [9462, -6995], [9545, -7764], [9295, -8122], [8779, -8126], [8072, -7854]]],
  ["4:precision=double", expected.o]
] as const) {
  it(`anlms matches native samples with ${options}`, async () => {
    const { result, error, frames } = await run(`anlms=${options}`);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(frames, expectedFrames);
  });
}
