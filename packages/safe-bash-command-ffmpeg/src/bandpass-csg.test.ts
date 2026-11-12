import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
  [12000, -1000, 0, 0, 1000, 2000, -5000, 9000, 0, -12000, 15000, 0], sample => sample / 32768
)] });
// Complete PCM16 output from native FFmpeg 7.0.2 for the fixture above.
const peakGain = [1537, 2040, 198, -1110, -1585, -1154, -1218, 36, 1598, -462, 80, 1994];
const skirtGain = [3074, 4081, 396, -2220, -3171, -2309, -2436, 73, 3197, -925, 160, 3989];
const halfQ = [2221, 2078, -679, -1047, -705, -76, -1005, 290, 1482, -2451, -106, 2748];
const hertz = [3285, 4678, 930, -2361, -4088, -3577, -3505, -279, 3972, 480, 1401, 4983];

for (const [options, expected] of [
  ["t=q:w=2", peakGain],
  ["t=q:w=2:csg=0", peakGain],
  ["t=q:w=2:csg=false", peakGain],
  ["t=q:w=2:csg=off", peakGain],
  ["t=q:w=2:csg=1", skirtGain],
  ["t=q:w=2:csg=YES", skirtGain],
  ["t=q:w=0.5:csg=true", halfQ],
  ["t=h:w=200:csg=1", hertz],
  ["t=k:w=0.2:csg=1", hertz],
  ["t=o:w=1:csg=1", [2884, 3576, 14, -2013, -2433, -1459, -1826, 193, 2618, -1705, -315, 3550]],
  ["t=s:w=0.5:csg=1", halfQ],
  ["t=q:w=2:csg=1:mix=0.5", [7537, 1540, 198, -1110, -1085, -154, -3718, 4536, 1598, -6462, 7580, 1994]]
] as const) {
  for (const graph of [false, true]) it(`matches native bandpass ${options}, graph=${graph}`, async () => {
    const { result, stderr, output } = await run(`bandpass=f=800:${options}`, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const filter of ["bandpass=csg=2", "bandpass=csg=-1", "bandpass=csg=invalid", "lowpass=csg=1", "highpass=csg=1"]) {
  for (const graph of [false, true]) it(`rejects ${filter} without replacing output, graph=${graph}`, async () => {
    const { fs, result, stderr, output } = await run(filter, graph, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("csg"), stderr);
    assert.equal(output.length, 0);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph: boolean, destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(chunk: Uint8Array) { chunks.push(chunk.slice()); } },
    stderr: { async write(chunk: Uint8Array) { stderr += new TextDecoder().decode(chunk); } }
  } as never);
  return { fs, result, stderr, output: Buffer.concat(chunks) };
}
