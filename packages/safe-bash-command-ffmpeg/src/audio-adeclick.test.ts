import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { declickAudio } from "./audio-adeclick.js";
import { createFfmpegCommand } from "./index.js";


const samples = Float64Array.from({ length: 8000 }, (_, i) =>
  (i % 1409 === 1000 ? 31000 : Math.floor(3000 * Math.sin(2 * Math.PI * i / 40) + 0.5)
    + (i % 1600 >= 800 ? (i % 2 ? 9000 : -9000) : 0)) / 32768);

async function run(filter: string, graph = false, sampleRate = 8000) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate, channels: [1, -1].map(sign => Float64Array.from(samples, value => sign * value)) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, error: Buffer.concat(errors).toString() };
}

for (const graph of [false, true]) it(`adeclick removes isolated impulses (${graph ? "graph" : "simple"})`, async () => {
  const { result, fs, error } = await run("adeclick", graph);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  for (const [c, channel] of audio.channelData.entries()) {
    assert.equal(channel.length, samples.length);
    for (const [offset, expected] of [-9927, 8531, -9059, 9469, -8253].entries()) {
      assert.ok(Math.abs(channel[998 + offset]! * 32768 - expected * (c ? -1 : 1)) <= 1,
        `channel ${c}, sample ${998 + offset}: ${channel[998 + offset]! * 32768}`);
    }
  }
});

it("anull preserves the impulse and its immediate neighbors", async () => {
  const { result, fs, error } = await run("anull");
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!), Array.from(samples));
});

for (const [filter, references] of [
  ["adeclick", [[0, 0], [1, 3], [800, -3337], [2409, 12417], [3818, 887], [5227, -2360], [6636, -1604], [7998, -9927], [7999, 8531]]],
  ["adeclick=w=40:o=50:a=3:t=3:b=1:m=save", [[0, 0], [1, 390], [800, -9000], [1000, -9089], [2409, 11843], [3818, 886], [5227, -2375], [6636, -1630], [7999, 8531]]]
] as const) it(`matches native PCM16 across the recording: ${filter}`, async () => {
  const { result, fs, error } = await run(filter);
  assert.equal(result.exitCode, 0, error);
  const channel = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
  for (const [i, expected] of references) assert.ok(Math.abs(channel[i]! * 32768 - expected) <= 1, `sample ${i}: ${channel[i]! * 32768}, expected ${expected}`);
});

for (const filter of ["adeclick=window=9", "adeclick=o=96", "adeclick=a=-1", "adeclick=t=0", "adeclick=b=11", "adeclick=m=2", "adeclick=m=0.5", "adeclick=unknown=1", "adeclick=t="]) {
  it(`rejects invalid options without overwriting output: ${filter}`, async () => {
    const { result, fs } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

it("handles short silent input and bounds resources", async () => {
  const silent = [new Float64Array(12)];
  assert.deepEqual(await declickAudio(silent, 8000, "adeclick", new MediaBudgetTracker()), silent);
  await assert.rejects(declickAudio([samples], 8000, "adeclick", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(declickAudio([samples], 8000, "adeclick", new MediaBudgetTracker(), AbortSignal.abort()));
});

it("applies filters in chain order", async () => {
  const first = await run("adeclick");
  const second = await run("adeclick,volume=0.5");
  assert.equal(second.result.exitCode, 0, second.error);
  const original = parseWav(first.fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
  const scaled = parseWav(second.fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
  assert.ok(Math.abs(scaled[1000]! * 32768 - original[1000]! * 16384) <= 1);
});
