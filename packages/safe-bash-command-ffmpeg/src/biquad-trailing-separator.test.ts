import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from([12000, 0, -8000, 7000, 0, 5000, -3000, 1000], value => value / 32768),
  Float64Array.from([-6000, 1000, 20000, -4000, 0, 15000, 0, 1000], value => value / 32768)
] });

// Complete native FFmpeg 7.0.2 PCM16 reference streams.
for (const [filter, expected] of [
  ["lowpass=f=400", [240, -120, 858, -409, 1265, -239, 1244, 630, 1251, 1379, 1395, 1970, 1517, 2792, 1473, 3417]],
  ["lowpass=f=400:c=FL", [240, -6000, 858, 1000, 1265, 20000, 1244, -4000, 1251, 0, 1395, 15000, 1517, 0, 1473, 1000]],
  ["bandpass=f=800", [4442, -2221, 4526, -1893, -3943, 8272, -2603, 7070, 1332, -2346, 1293, 2807, -138, 3469, -1957, -2375]]
] as const) {
  for (const graph of [false, true]) {
    for (const suffix of ["", ":"]) it(`matches native ${filter}${suffix} (graph=${graph})`, async () => {
      const { result, stderr, samples } = await run(filter + suffix, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(samples, expected);
    });
  }
}

for (const name of ["lowpass", "highpass", "bandpass", "bass", "lowshelf", "treble", "highshelf"]) {
  it(`accepts a single trailing separator for ${name}`, async () => {
    const baseline = await run(`${name}=400`);
    const trailing = await run(`${name}=400:`);
    assert.equal(baseline.result.exitCode, 0, baseline.stderr);
    assert.equal(trailing.result.exitCode, 0, trailing.stderr);
    assert.equal(trailing.stderr, "");
    assert.deepEqual(trailing.samples, baseline.samples);
  });
  for (const options of ["f=400::", "f=400::c=FL", "f=:", "unknown=400:"]) {
    it(`rejects ${name}=${options} without overwriting output`, async () => {
      const { fs, result, stderr, samples } = await run(`${name}=${options}`, false, "/out.wav");
      assert.equal(result.exitCode, 1);
      assert.ok(stderr.includes(`${name}:`), stderr);
      assert.deepEqual(samples, []);
      assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
    });
  }
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
