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
  ["highshelf=g=0", samples],
  ["treble", samples],
  ["highshelf", samples]
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

async function run(filter: string, graph = false, format = "s16le", destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
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
