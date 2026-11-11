import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { deessAudio } from "./audio-deesser.js";
import { createFfmpegCommand } from "./index.js";

const mono = Float64Array.from({ length: 48000 }, (_, i) =>
  (i % 1409 === 1000 ? 31000 : Math.floor(3000 * Math.sin(2 * Math.PI * i / 40) + 0.5)
    + (i % 1600 >= 800 ? Math.floor(9000 * Math.sin((i * i) % 8191) + 0.5) : 0)) / 32768);
const right = Float64Array.from({ length: 2048 }, (_, i) => Math.round(4096 * Math.sin(2 * Math.PI * i / 96)) / 32768);
const left = Float64Array.from(right, (value, i) => value + (i >= 512 && i < 1536 ? [0, 12000, 0, -12000][i % 4]! / 32768 : 0));

// Native FFmpeg PCM16 references on the same mono and stereo fixtures.
for (const [mode, expected] of [
  ["o", [0, -470, 172, -2422, 1912, -2408, 118, -2534, -4885]],
  ["e", [0, 1, 5619, -2261, 29088, -394, 30882, 2534, 416]]
] as const) for (const graph of [false, true]) it(`deesser ${mode} matches native mono (graph=${graph})`, async () => {
  const { fs, result, stderr } = await run(`deesser=i=0.8:m=0.5:f=0.5:s=${mode}`, graph);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 48000);
  assert.equal(audio.channelData[0]!.length, mono.length);
  for (const [n, i] of [0, 799, 800, 999, 1000, 1001, 2409, 16000, 47999].entries()) {
    assert.ok(Math.abs(audio.channelData[0]![i]! * 32768 - expected[n]!) <= 1, `sample ${i}`);
  }
});

for (const [mode, expected] of [["i", [12268, 268]], ["o", [2522, 268]], ["e", [9746, 0]]] as const) {
  it(`deesser stereo ${mode} processes channels independently`, async () => {
    const filter = `deesser=0.8:0.5:0.5:${mode}`;
    const stereo = await run(filter, false, [left, right]);
    assert.equal(stereo.result.exitCode, 0, stereo.stderr);
    const channels = parseWav(stereo.fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
    for (const [c, input] of [left, right].entries()) {
      assert.ok(Math.abs(channels[c]![769]! * 32768 - expected[c]!) <= 1);
      const single = await run(filter, false, [input]);
      assert.equal(single.result.exitCode, 0, single.stderr);
      assert.deepEqual(channels[c], parseWav(single.fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]);
    }
  });
}

for (const filter of ["deesser=i=1:s=e", "deesser=1:0.5:0.5:e"]) {
  for (const graph of [false, true]) it(`${filter} accepts a trailing separator (graph=${graph})`, async () => {
    const channels = [Float64Array.from({ length: 384 }, (_, i) => ((i * 7919) % 50000 - 25000) / 32768)];
    const expected = await run(filter, graph, channels);
    const actual = await run(`${filter}:`, graph, channels);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.fs.readFileSync("/out.wav"), expected.fs.readFileSync("/out.wav"));
  });
}

for (const filter of ["anull", "deesser", "deesser=i=0.8:s=i", "deesser=i=0.8:m=1"]) it(`${filter} preserves input`, async () => {
  const { fs, result, stderr } = await run(filter);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(Array.from(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!), Array.from(mono));
});

for (const option of ["i=-1", "m=1.1", "f=NaN", "i=", "s=3", "s=0.5", "unknown=1"]) it(`rejects ${option} without overwriting output`, async () => {
  const { fs, result } = await run(`deesser=${option}`);
  assert.equal(result.exitCode, 1);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
});

for (const option of ["i=1::s=e", "i=1:s=e::", "i=1:s=:"]) it(`rejects empty options in ${option} without overwriting output`, async () => {
  const { fs, result } = await run(`deesser=${option}`);
  assert.equal(result.exitCode, 1);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
});

for (const graph of [false, true]) {
  it(`deesser scheduling options preserve audio (graph=${graph})`, async () => {
    for (const filter of ["deesser", "deesser=i=0.8:m=0.5:f=0.5:s=o"]) {
      const baseline = await run(filter, graph, [mono.slice(0, 2048)]);
      assert.equal(baseline.result.exitCode, 0, baseline.stderr);
      for (const option of [
        "threads=1", "extra_hw_frames=1", "threads=0:extra_hw_frames=-1",
        "threads=2147483647:extra_hw_frames=2147483647",
        "threads=default:extra_hw_frames=default", "threads=min:extra_hw_frames=min",
        "threads=max:extra_hw_frames=max", "threads=1+1:extra_hw_frames=min+1",
        "threads=0.5:extra_hw_frames=-0.5", "threads=1:threads=2:extra_hw_frames=1"
      ]) {
        const actual = await run(`${filter}${filter.includes("=") ? ":" : "="}${option}`, graph, [mono.slice(0, 2048)]);
        assert.equal(actual.result.exitCode, 0, `${option}: ${actual.stderr}`);
        assert.deepEqual(actual.fs.readFileSync("/out.wav"), baseline.fs.readFileSync("/out.wav"), option);
        assert.deepEqual(actual.fs.readFileSync("/in.wav"), baseline.fs.readFileSync("/in.wav"));
      }
    }
  });

  it(`deesser rejects invalid scheduling options without overwriting output (graph=${graph})`, async () => {
    for (const option of [
      "threads=-1", "threads=-0.1", "threads=2147483648", "threads=", "threads=bogus",
      "threads=NaN", "threads=1/0", "threads=bogus:threads=1",
      "extra_hw_frames=-2", "extra_hw_frames=-1.1", "extra_hw_frames=2147483648",
      "extra_hw_frames=", "extra_hw_frames=bogus", "extra_hw_frames=NaN",
      "extra_hw_frames=1/0", "threads=1:unknown=1"
    ]) {
      const actual = await run(`deesser=${option}`, graph, [mono.slice(0, 384)]);
      assert.equal(actual.result.exitCode, 1, option);
      assert.ok(actual.stderr.includes("deesser:"), actual.stderr);
      assert.equal(actual.fs.readFileSync("/out.wav", "utf8"), "keep", option);
    }
  });
}

async function run(filter: string, graph = false, channels = [mono]) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { fs, result, stderr };
}


it("bounds memory and honors cancellation", async () => {
  await assert.rejects(deessAudio([mono], 48000, "deesser", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(deessAudio([mono], 48000, "deesser", new MediaBudgetTracker(), AbortSignal.abort()));
});

it("applies subsequent filters to the processed signal", async () => {
  const { fs, result, stderr } = await run("deesser=i=0.8,volume=0.5");
  assert.equal(result.exitCode, 0, stderr);
  const channel = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
  assert.ok(Math.abs(channel[1000]! * 32768 - 956) <= 1);
});
