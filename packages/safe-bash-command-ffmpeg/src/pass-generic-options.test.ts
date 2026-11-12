import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [12000, -6000, 0, 1000, -8000, 20000, 7000, -4000, 0, 0, 5000, 15000, -3000, 0, 1000, 1000];
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from(samples.filter((_, index) => index % 2 === channel), value => value / 32768)) });

// Complete interleaved PCM16 output from native FFmpeg 7.0.2.
for (const [filter, expected] of [
  ["lowpass=f=400", [240, -120, 858, -409, 1265, -239, 1244, 630, 1251, 1379, 1395, 1970, 1517, 2792, 1473, 3417]],
  ["bandpass=f=800", [4442, -2221, 4526, -1893, -3943, 8272, -2603, 7070, 1332, -2346, 1293, 2807, -138, 3469, -1957, -2375]]
] as const) {
  for (const graph of [false, true]) {
    for (const options of ["", ":threads=1", ":extra_hw_frames=2", ":threads=1:extra_hw_frames=2",
      ":threads=0:extra_hw_frames=-1", ":threads=default:extra_hw_frames=min",
      ":threads=1+1:extra_hw_frames=3/2", ":threads=max:extra_hw_frames=max"]) {
      it(`accepts ${filter}${options} (graph=${graph}) without changing samples`, async () => {
        const { result, stderr, output } = await run(filter + options, graph);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      });
    }
    for (const options of ["threads=-1", "threads=2147483648", "threads=NaN", "threads=bogus", "threads=",
      "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=NaN", "extra_hw_frames=bogus", "extra_hw_frames="]) {
      it(`rejects ${filter}:${options} (graph=${graph}) without replacing output`, async () => {
        const { result, stderr, output, fs } = await run(`${filter}:${options}`, graph, "/out.raw");
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes(filter.split("=", 1)[0]!), stderr);
        assert.equal(output.length, 0);
        assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
      });
    }
  }
}

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
    stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { result, stderr, output: Buffer.concat(chunks), fs };
}
