import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 output at each 512-sample WAV frame boundary.
for (const [expression, expected] of [
  ["floor(t*10)/10", [0, 0, 1200, 1200, 2400, 3600, 3600, 4800]],
  ["ceil(t*10)/10", [0, 1200, 2400, 2400, 3600, 4800, 4800, 6000]],
  ["trunc(t*10)/10", [0, 0, 1200, 1200, 2400, 3600, 3600, 4800]],
  ["round(t*10)/10", [0, 1200, 1200, 2400, 3600, 3600, 4800, 4800]],
  ["ceil(0.1)", Array(8).fill(12000)],
  ["trunc(-0.8)", Array(8).fill(0)],
  ["round(0.5)", Array(8).fill(12000)],
  ["0.5", Array(8).fill(6000)]
] as const) {
  it(`evaluates stepped volume ${expression}`, async () => {
    const { result, fs, stderr } = await run(`volume='${expression}':eval=frame`);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 8192);
    for (let i = 0; i < 4096; i++) {
      assert.equal(output.readInt16LE(i * 2), expected[Math.floor(i / 512)], `sample ${i}`);
    }
  });
}

// Exact binary fractions exercise both signs, integers, and half-way boundaries.
for (const [name, expected] of [
  ["floor", [-16384, -16384, -8192, -8192, 0, 0, 8192, 8192, 8192]],
  ["ceil", [-8192, -8192, -8192, 0, 0, 8192, 8192, 16384, 16384]],
  ["trunc", [-8192, -8192, -8192, 0, 0, 0, 8192, 8192, 8192]],
  ["round", [-16384, -8192, -8192, -8192, 0, 8192, 8192, 8192, 16384]]
] as const) {
  it(`evaluates ${name} per sample including negative boundaries`, async () => {
    const samples = Float64Array.from([-1.5, -1.25, -1, -0.5, 0, 0.5, 1, 1.25, 1.5], x => x / 4);
    const { result, fs, stderr } = await run(`aeval='${name}(val(ch)*4)/4':c=same`, samples);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, samples.length * 2);
    assert.deepEqual(Array.from(samples, (_, i) => output.readInt16LE(i * 2)), expected);
  });
  for (const args of ["", "0,1"]) {
    it(`rejects ${name}(${args}) without overwriting output`, async () => {
      const { result, fs } = await run(`volume='${name}(${args})':eval=frame`);
      assert.equal(result.exitCode, 234);
      assert.equal(fs.readFileSync("/out.raw", "utf8"), "keep");
    });
  }
}

async function run(filter: string, samples = new Float64Array(4096).fill(12000 / 32768)) {
  const fs = Volume.fromJSON({ "/out.raw": "keep" });
  fs.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/tone.wav", "-af", filter, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, stderr: Buffer.concat(errors).toString() };
}
