import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [12000, -1000, 0, 0, 1000, 2000, -5000, 9000, 0, -12000, 15000, 0];
const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });

// Native FFmpeg 7.0.2 PCM16 output for the complete mono 8 kHz fixture.
for (const [filter, named, expected] of [
  ["lowpass=500:q:1", "lowpass=f=500:t=q:w=1", [383, 1329, 2121, 2355, 2245, 2011, 1595, 1141, 1102, 839, 266, 417]],
  ["bandpass=800:h:200", "bandpass=f=800:t=h:w=200", [821, 1169, 232, -590, -1022, -894, -876, -69, 993, 120, 350, 1245]],
  ["equalizer=800:q:1:4:0.5:FC", "equalizer=f=800:t=q:w=1:g=4:m=0.5:c=FC", [12664, -184, -6, -460, 455, 1682, -5410, 9046, 592, -12413, 14919, 815]],
  ["bandreject=800:h:200:0.5:FC", "bandreject=f=800:t=h:w=200:m=0.5:c=FC", [11589, -1584, -116, 295, 1511, 2447, -4561, 9034, -496, -12060, 14824, -622]],
  ["bass=300:q:1:4", "bass=f=300:t=q:w=1:g=4", [12285, -360, 766, 855, 1920, 2999, -4080, 9942, 1091, -11216, 15698, 918]],
  ["highpass=500:q:1:1:0.5:FC", "highpass=f=500:t=q:w=1:p=1:m=0.5:c=FC", [11025, -2550, -966, -652, 478, 1404, -5158, 8568, -1022, -11716, 14948, -1252]],
  ["lowshelf=300:q:1:4:2:0.5:FC", "lowshelf=f=300:t=q:w=1:g=4:p=2:m=0.5:c=FC", [12181, -623, 402, 416, 1426, 2453, -4616, 9400, 497, -11709, 15268, 438]],
  ["treble=300:q:1:4:2:0.5:FC", "treble=f=300:t=q:w=1:g=4:p=2:m=0.5:c=FC", [15288, -1775, -552, -583, 701, 1979, -6958, 11156, -557, -15795, 19178, -378]],
  ["highshelf=300:q:1:4:2:0.5:FC", "highshelf=f=300:t=q:w=1:g=4:p=2:m=0.5:c=FC", [15229, -1854, -563, -544, 772, 2060, -6845, 11245, -518, -15688, 19237, -423]],
  ["lowpass@cut=f=500:q:1", "lowpass=f=500:t=q:w=1", [383, 1329, 2121, 2355, 2245, 2011, 1595, 1141, 1102, 839, 266, 417]],
  ["lowpass=500:t=q:800", "lowpass=f=800:t=q", [809, 2476, 3170, 2534, 1655, 1115, 592, 283, 956, 773, -117, 760]],
  ["lowpass=500:q:w=1:800", "lowpass=f=800:t=q:w=1", [885, 2804, 3762, 3100, 1897, 976, 185, -227, 574, 620, -201, 737]],
  ["lowpass=500:q:1:", "lowpass=f=500:t=q:w=1", [383, 1329, 2121, 2355, 2245, 2011, 1595, 1141, 1102, 839, 266, 417]]
] as const) {
  for (const graph of [false, true]) it(`matches native positional ${filter} (graph=${graph})`, async () => {
    const reference = await run(named, graph);
    assert.equal(reference.result.exitCode, 0, reference.stderr);
    assert.deepEqual(reference.samples, expected);
    const actual = await run(filter, graph);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.deepEqual(actual.samples, expected);
  });
}

for (const filter of [
  "lowpass=500:bogus:1", "lowpass=500:q:-1", "bass=300:q:1:901",
  "highpass=500:q:1:3", "lowpass=500:q:1:2:2"
]) it(`rejects invalid positional ${filter} without replacing output`, async () => {
  const { result, samples: output, fs } = await run(filter, false, "/out.raw");
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(output, []);
  assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
});

async function run(filter: string, graph: boolean, destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-hide_banner", "-loglevel", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  const output = Buffer.concat(chunks);
  return { result, stderr, fs, samples: Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)) };
}
