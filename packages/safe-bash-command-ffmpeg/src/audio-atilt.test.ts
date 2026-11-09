import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const rate = 96000;
const frequencies = [40, 1000, 30000];
const tones = Float64Array.from({ length: 38400 }, (_, i) =>
  Math.round(500 + frequencies.reduce((sum, f) => sum + 2000 * Math.sin(2 * Math.PI * f * i / rate), 0)) / 32768);

async function run(filter: string, channels = [tones], complex = false) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: rate, channels }));
  await fs.writeFile("/out.raw", new TextEncoder().encode("KEEP"));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stderr, bytes: Buffer.from(await fs.readFile("/out.raw")) };
}

// Native FFmpeg 7.0.2 reference: projections over the final 19200 samples.
for (const [slope, amplitudes, first] of [
  [0, [2000, 2000, 2000], [500, 2484, -643, 141]],
  [0.3, [2000, 2192, 2594], [641, 3172, -907, 125]],
  [-0.3, [2000, 1835, 1542], [390, 1947, -449, 147]]
] as const) {
  it(`atilt matches native spectral amplitudes and transients for slope ${slope}`, async () => {
    const result = await run(`atilt=freq=1000:slope=${slope}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.bytes.length, tones.length * 2);
    first.forEach((value, i) => assert.ok(Math.abs(result.bytes.readInt16LE(i * 2) - value) <= 1));
    let mean = 0;
    for (let i = 19200; i < tones.length; i++) mean += result.bytes.readInt16LE(i * 2) / 19200;
    assert.ok(Math.abs(mean - 500) < 1);
    frequencies.forEach((frequency, index) => {
      let real = 0;
      let imaginary = 0;
      for (let i = 19200; i < tones.length; i++) {
        const phase = 2 * Math.PI * frequency * i / rate;
        const sample = result.bytes.readInt16LE(i * 2);
        real += sample * Math.cos(phase);
        imaginary += sample * Math.sin(phase);
      }
      const amplitude = 2 * Math.hypot(real, imaginary) / 19200;
      assert.ok(Math.abs(amplitude - amplitudes[index]!) < 1, `${frequency} Hz: ${amplitude}`);
    });
    if (slope === 0) assert.deepEqual(result.bytes, (await run("anull")).bytes);
  });
}

it("atilt defaults preserve PCM and positional options work in a linked filter chain", async () => {
  const input = [Float64Array.from([0.1, -0.1, 0.2, -0.2]), new Float64Array(4)];
  const unchanged = await run("atilt", input);
  assert.equal(unchanged.exitCode, 0, unchanged.stderr);
  assert.deepEqual(unchanged.bytes, (await run("anull", input)).bytes);
  const named = await run("atilt=freq=1000:slope=0.3:width=2000:order=8:level=0.5,volume=0.5", input);
  const positional = await run("atilt=1000:0.3:2000:8:0.5,volume=0.5", input, true);
  assert.equal(named.exitCode, 0, named.stderr);
  assert.equal(positional.exitCode, 0, positional.stderr);
  assert.deepEqual(positional.bytes, named.bytes);
  assert.notDeepEqual(named.bytes, unchanged.bytes);
  for (let i = 0; i < 4; i++) assert.equal(named.bytes.readInt16LE(i * 4 + 2), 0);
});

for (const option of ["freq=19", "freq=192001", "slope=1.1", "slope=-1.1", "width=99", "width=10001",
  "order=1", "order=31", "order=2.5", "level=-1", "level=4.1", "slope=NaN", "freq=", "unknown=1"]) {
  it(`atilt rejects ${option} without replacing output`, async () => {
    const result = await run(`atilt=${option}`, [new Float64Array(4)]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("atilt:"), result.stderr);
    assert.equal(result.bytes.toString(), "KEEP");
  });
}
