import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32767, -32768, -32768, 32767];
const bytes = encodeWav({ sampleRate: 8000, channels: [0, 1].map(c =>
  Float64Array.from(input.filter((_, i) => i % 2 === c), value => value / 32768)) });

// Interleaved PCM16 output from FFmpeg 7.0.2. Zero gain still runs the biquad.
for (const [filter, expected] of [
  ["anull", input],
  ["bass", [1, 2, 3, 6, 5, 10, -1, -2, -2, -5, -5, -10, 32767, -32768, -32768, 32767]],
  ["lowshelf=g=-3", [0, 1, 2, 5, 4, 9, -1, -2, -3, -6, -5, -10, 32341, -32342, -32768, 32767]],
  ["lowshelf=g=0", [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32766, -32768, -32768, 32767]],
  ["bass=g=3:p=1", [1, 2, 3, 6, 5, 10, 0, -1, -2, -5, -4, -9, 32767, -32768, -32363, 32362]],
  ["bass=g=3:m=0.5", [1, 2, 3, 6, 5, 10, 0, -1, -2, -5, -4, -9, 32767, -32768, -32609, 32608]],
  ["bass=g=3:c=FL", [1, 2, 3, 6, 5, 10, 0, -2, -2, -6, -4, -10, 32767, -32768, -32450, 32767]],
  ["bass=frequency=200:gain=6:width=0.7:width_type=q", [1, 2, 3, 6, 5, 10, 0, 0, -2, -4, -4, -9, 32767, -32768, -31661, 31660]],
  ["lowshelf=f=200:g=6:t=s:w=0.7", [1, 2, 3, 6, 5, 11, 0, 0, -2, -4, -4, -9, 32767, -32768, -31343, 31341]],
  ["bass=g=3,volume=1", [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32767, -32768, -32451, 32450]],
  ["lowshelf=g=3:r=f64", [1, 2, 3, 6, 5, 10, -1, -2, -3, -6, -5, -10, 32767, -32768, -32364, 32363]],
  ["lowshelf=g=3:mix=0", input],
  ["bass=g=3", [1, 2, 3, 6, 5, 10, 0, -1, -2, -5, -4, -9, 32767, -32768, -32450, 32449]],
  ["lowshelf=g=3", [1, 2, 3, 6, 5, 10, 0, -1, -2, -5, -4, -9, 32767, -32768, -32364, 32363]],
  ["bass=g=-3", [0, 1, 2, 5, 4, 9, -1, -2, -3, -6, -5, -10, 32454, -32455, -32768, 32767]],
  ["bass=g=0", [1, 2, 3, 6, 5, 10, -1, -2, -2, -5, -5, -10, 32767, -32768, -32768, 32767]]
] as const) {
  for (const graph of [false, true]) it(`matches native stereo PCM for ${filter} (graph=${graph})`, async () => {
    const { result, stderr, samples } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(samples, expected);
  });
}

async function run(filter: string, graph = false, output = "pipe:1") {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const chunks: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", output],
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
  const pcm = Buffer.concat(chunks);
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
  return { fs, result, stderr, samples };
}

for (const name of ["bass", "lowshelf"]) {
  for (const option of ["g=NaN", "gain=901", "gain=-901", "g=", "f=-1", "w=-1", "p=3", "m=2", "unknown=1"]) {
    it(`rejects ${name}=${option} without overwriting output`, async () => {
      const { fs, result, stderr, samples } = await run(`${name}=${option}`, false, "/out.wav");
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes(name), stderr);
      assert.deepEqual(samples, []);
      assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
    });
  }
}
