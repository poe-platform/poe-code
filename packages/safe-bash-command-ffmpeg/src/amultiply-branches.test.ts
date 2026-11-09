import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const ramp = Array.from({ length: 128 }, (_, i) => [2000, 4000, -6000, 8000][i % 4]!);
const gain = Array<number>(128).fill(16384);

async function run(graph: string, first = ramp, second = gain, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [path, samples] of [["/ramp.wav", first], ["/gain.wav", second]] as const) {
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/ramp.wav", "-i", "/gain.wav", "-filter_complex", graph,
      "-map", "[out]", ...options, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}

// Native FFmpeg PCM16 results for the reported 128-sample, 8 kHz mono inputs.
for (const [name, graph, expected] of [
  ["first branch volume", "[0:a]volume=0.5[x];[x][1:a]amultiply[out]", ramp.map(v => v / 4)],
  ["second branch volume", "[1:a]volume=0.5[x];[0:a][x]amultiply[out]", ramp.map(v => v / 4)],
  ["first branch reverse", "[0:a]areverse[x];[x][1:a]amultiply[out]", ramp.slice().reverse().map(v => v / 2)],
  ["both branches", "[0:a]areverse[x];[1:a]volume=0.5[y];[x][y]amultiply[out]", ramp.slice().reverse().map(v => v / 4)],
  ["chained labels and downstream volume", "[0:a]areverse[x];[x]volume=0.5[y];[y][1:a]amultiply,volume=0.5[out]", ramp.slice().reverse().map(v => v / 8)],
  ["shortened first branch", "[0:a]atrim=end_sample=7[x];[x][1:a]amultiply[out]", ramp.slice(0, 7).map(v => v / 2)],
  ["shortened second branch", "[1:a]atrim=end_sample=5[x];[0:a][x]amultiply[out]", ramp.slice(0, 5).map(v => v / 2)],
  ["anull control", "[0:a]anull[x];[x][1:a]amultiply[out]", ramp.map(v => v / 2)]
] as const) {
  it(`amultiply evaluates ${name}`, async () => {
    const { result, volume, error } = await run(graph);
    assert.equal(result.exitCode, 0, error);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
  });
}

it("amultiply evaluates reversal on its second branch", async () => {
  const { result, volume, error } = await run("[1:a]areverse[x];[0:a][x]amultiply[out]", gain, ramp);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), ramp.slice().reverse().map(v => v / 2));
});

it("amultiply keeps split source samples independent", async () => {
  const { result, volume, error } = await run("[0:a]asplit[a][b];[a]areverse[x];[x][b]amultiply[out]");
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
    ramp.map((v, i) => Math.round(v * ramp[ramp.length - 1 - i]! / 32768)));
});

it("amultiply rejects an invalid branch filter without replacing output", async () => {
  const { result, volume, error } = await run("[0:a]volume=bad[x];[x][1:a]amultiply[out]");
  assert.notEqual(result.exitCode, 0);
  assert.match(error, /volume/);
  assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
});

it("amultiply uses the sample rates produced by branch filters", async () => {
  const { result, volume, error } = await run("[0:a]asetrate=16000[x];[1:a]asetrate=16000[y];[x][y]amultiply[out]");
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), ramp.map(v => v / 2));
});

it("amultiply uses the channel layouts produced by branch filters", async () => {
  const { result, volume, error } = await run("[0:a]pan=stereo|c0=c0|c1=c0[x];[1:a]pan=stereo|c0=c0|c1=c0[y];[x][y]amultiply[out]");
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.channels, 2);
  for (const channel of audio.channelData) {
    assert.deepEqual(Array.from(channel, sample => sample * 32768), ramp.map(v => v / 2));
  }
});

it("amultiply applies output duration after upstream reversal", async () => {
  const { result, volume, error } = await run("[0:a]areverse[x];[x][1:a]amultiply[out]", ramp, gain, ["-t", "0.0005"]);
  assert.equal(result.exitCode, 0, error);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), [4000, -3000, 2000, 1000]);
});
