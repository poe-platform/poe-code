import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { declickAudio } from "./audio-adeclick.js";
import { createFfmpegCommand } from "./index.js";

// PCM16 references captured with FFmpeg 7.0.2: -af adeclip -c:a pcm_s16le.
const input = readFileSync(new URL("./fixtures/adeclip-input.wav", import.meta.url));
const reference = parseWav(readFileSync(new URL("./fixtures/adeclip-native.wav", import.meta.url)))
  .tracks[0]!.decodedAudio!.channelData[0]!;
const samples = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;

async function run(filter?: string, graph = false, audio: Uint8Array = input) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", audio);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(filter === undefined ? [] : graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, error: Buffer.concat(errors).toString() };
}

for (const graph of [false, true]) it(`adeclip reconstructs native clipped PCM peaks (${graph ? "graph" : "simple"})`, async () => {
  const { result, fs, error } = await run("adeclip", graph);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.deepEqual(audio.channelData[0], reference);
  assert.equal(audio.channelData[0]![800]! * 32768, 8979);
});

it("preserves the clipped PCM when no filter is requested", async () => {
  const { result, fs, error } = await run();
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0], samples);
});

it("restores stereo channels independently and applies the following filter", async () => {
  const stereo = encodeWav({ sampleRate: 16000, channels: [Float64Array.from(samples), Float64Array.from(samples, value => -value)] });
  const { result, fs, error } = await run("adeclip,volume=0.5", false, stereo);
  assert.equal(result.exitCode, 0, error);
  const channels = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
  for (const [c, channel] of channels.entries()) {
    assert.equal(channel.length, reference.length);
    for (let i = 0; i < channel.length; i++) {
      assert.ok(Math.abs(channel[i]! * 32768 - reference[i]! * 16384 * (c ? -1 : 1)) <= 1, `channel ${c}, sample ${i}`);
    }
  }
});

for (const filter of [
  "adeclip=w=40:o=50:a=3:t=3:n=500:m=save",
  "adeclip=window=40:overlap=50:arorder=3:threshold=3:hsize=500:method=s",
  "adeclip=40:50:3:3:500:1"
]) it(`matches native overlap-save with custom options: ${filter}`, async () => {
  const { result, fs, error } = await run(filter);
  assert.equal(result.exitCode, 0, error);
  const channel = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
  assert.equal(channel.length, samples.length);
  // FFmpeg 7.0.2, same input with the custom options above.
  for (const [i, expected] of [[0, 0], [1, 1574], [20, 10320], [64, -10455], [201, -14620], [800, 13019], [1500, -9609], [3041, 10928], [6001, -12818], [7999, 1574], [8000, 0], [8191, 3934]] as const) {
    assert.equal(channel[i]! * 32768, expected, `sample ${i}`);
  }
});

for (const [filter, exitCode] of [
  ["adeclip=w=9", 222],
  ["adeclip=o=96", 222],
  ["adeclip=a=-1", 222],
  ["adeclip=t=0", 222],
  ["adeclip=n=99", 222],
  ["adeclip=hsize=10000", 222],
  ["adeclip=n=99.9", 222],
  ["adeclip=hsize=9999.1", 222],
  ["adeclip=m=2", 222],
  ["adeclip=m=-0.1", 222],
  ["adeclip=method=1.1", 222],
  ["adeclip=burst=2", 8],
  ["adeclip=b=2", 8],
  ["adeclip=t=", 234],
  ["adeclip=unknown=1", 8]
] as const) {
  it(`rejects invalid options without overwriting output: ${filter}`, async () => {
    const { result, fs, error } = await run(filter);
    assert.equal(result.exitCode, exitCode);
    assert.match(error, /adeclip: (invalid|unsupported option)/);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

it("handles silence, short input, memory limits, and cancellation", async () => {
  const silent = [new Float64Array(12)];
  assert.deepEqual(await declickAudio(silent, 16000, "adeclip", new MediaBudgetTracker()), silent);
  await assert.rejects(declickAudio([samples], 16000, "adeclip", new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(declickAudio([samples], 16000, "adeclip", new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
  await assert.rejects(declickAudio([samples], 16000, "adeclip", new MediaBudgetTracker(), AbortSignal.abort()));
});
