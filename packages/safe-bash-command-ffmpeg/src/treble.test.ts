import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { passAudio } from "./audio-pass.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32767, -32768, -32768, 32767];
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from(samples.filter((_, index) => index % 2 === channel), value => value / 32768)) });

// Native FFmpeg 7.0.2 signed PCM16, interleaved stereo at 8 kHz.
for (const [filter, expected] of [
  ["anull", samples],
  ["treble=g=3", [1, 2, 3, 6, 5, 10, -1, -3, -2, -5, -5, -10, 32767, -32768, -32768, 32767]],
  ["highshelf=g=3", [1, 2, 3, 6, 5, 10, -1, -3, -2, -5, -5, -10, 32767, -32768, -32768, 32767]],
  ["treble=g=-3", [0, 1, 2, 5, 4, 9, 0, 0, -3, -6, -4, -9, 29906, -29908, -25317, 25317]],
  ["highshelf=g=-3", [0, 1, 2, 5, 4, 9, 0, 0, -3, -6, -4, -9, 29612, -29615, -25378, 25378]],
  ["treble@gain=gain=3", [1, 2, 3, 6, 5, 10, -1, -3, -2, -5, -5, -10, 32767, -32768, -32768, 32767]],
  ["treble=g=3:r=f64", [1, 2, 3, 6, 5, 10, -2, -3, -3, -5, -5, -11, 32767, -32768, -32768, 32767]],
  ["treble=g=3,volume=1", [1, 2, 3, 6, 5, 10, -2, -3, -3, -5, -5, -11, 32767, -32768, -32768, 32767]],
  ["treble=g=-3:p=1", [0, 1, 2, 5, 4, 9, 0, 0, -3, -6, -4, -9, 29609, -29612, -25379, 25379]],
  ["highshelf=g=-3:p=1", [0, 1, 2, 5, 4, 9, 0, 0, -3, -6, -4, -9, 29609, -29612, -25379, 25379]],
  ["treble=g=-3:f=1000:w=1:t=s", [0, 1, 2, 4, 4, 8, 0, 0, -1, -3, -4, -8, 25192, -25196, -21141, 21137]],
  ["treble=g=-3:c=FL", [0, 2, 2, 6, 4, 10, 0, -2, -3, -6, -4, -10, 29906, -32768, -25317, 32767]],
  ["treble=g=-3:m=0.5", [0, 1, 2, 5, 4, 9, 0, -1, -3, -6, -4, -9, 31336, -31338, -29042, 29042]],
  ["treble=g=0", samples],
  ["highshelf=g=0", [1, 2, 3, 6, 5, 10, -1, -2, -2, -5, -5, -10, 32767, -32767, -32768, 32766]],
  ["treble", samples],
  ["highshelf", [1, 2, 3, 6, 5, 10, -1, -2, -2, -5, -5, -10, 32767, -32767, -32768, 32766]]
] as const) {
  for (const graph of [false, true]) {
    for (const format of ["s16le", "wav"]) it(`matches native ${filter} (${format}, graph=${graph})`, async () => {
      const { output, result, stderr } = await run(filter, graph, format);
      assert.equal(result.exitCode, 0, stderr);
      if (format === "wav") {
        const audio = parseWav(output).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, value => value * 32768)),
          [0, 1].map(channel => expected.filter((_, index) => index % 2 === channel)));
      } else {
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}

// Native FFmpeg 7.0.2: zero gain still runs the biquad and truncates PCM16.
const ramp = Array.from({ length: 23 }, (_, i) => 1000 * (i + 1) * (-1) ** i);
const rampInput = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(ramp, value => value / 32768)] });
for (const [filter, expected] of [
  ["anull", ramp],
  ["treble=f=500:g=0", [1000, -2000, 2999, -4000, 4999, -6000, 6999, -8000, 8999, -10000, 10999, -12000, 13000, -14000, 14999, -16000, 16999, -18000, 18999, -20000, 21000, -21999, 23000]],
  ["treble=f=500:g=0:b=4", [999, -2000, 2999, -3999, 4998, -6000, 6998, -8000, 8999, -9999, 10999, -11999, 12999, -14000, 14998, -16000, 16998, -18000, 18998, -20000, 20999, -21999, 23000]],
  ["highshelf=f=500:g=0:b=4", [1000, -1999, 2999, -3999, 4999, -6000, 6999, -7999, 8999, -9999, 10999, -11999, 13000, -13999, 15000, -15998, 17000, -17998, 19000, -19999, 20999, -21999, 23000]],
  ["treble=f=500:g=6", [1815, -3954, 5847, -7907, 9868, -11876, 13871, -15860, 17864, -19850, 21853, -23843, 25842, -27835, 29831, -31826, 32767, -32768, 32767, -32768, 32767, -32768, 32767]]
] as const) {
  for (const graph of [false, true]) it(`matches native PCM16 ramp ${filter} (graph=${graph})`, async () => {
    const { output, result, stderr } = await run(filter, graph, "s16le", "pipe:1", rampInput);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const option of ["g=NaN", "g=901", "g=-901", "g=", "unknown=1"]) {
  it(`rejects treble ${option} without replacing output`, async () => {
    const { fs, result, stderr, output } = await run(`treble=${option}`, false, "s16le", "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("treble"), stderr);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
    assert.equal(output.length, 0);
  });
}

it("bounds treble memory and honors cancellation", async () => {
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "treble=g=3", "s16",
    new MediaBudgetTracker({ maxMemoryBytes: 64 })), /maxMemoryBytes/);
  await assert.rejects(passAudio([new Float64Array(64)], 8000, "treble=g=3", "s16",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, format = "s16le", destination = "pipe:1", bytes = input) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(bytes), "/out.raw": "KEEP" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr, output: Buffer.concat(chunks) };
}
