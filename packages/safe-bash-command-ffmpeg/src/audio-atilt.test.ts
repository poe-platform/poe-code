import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const rate = 96000;
const frequencies = [40, 1000, 30000];
const tones = Float64Array.from({ length: 38400 }, (_, i) =>
  Math.round(500 + frequencies.reduce((sum, f) => sum + 2000 * Math.sin(2 * Math.PI * f * i / rate), 0)) / 32768);

async function run(filter: string, channels = [tones], complex = false, sampleRate = rate, pipe = false) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate, channels }));
  await fs.writeFile("/out.raw", new TextEncoder().encode("KEEP"));
  let stderr = "";
  const stdout: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", pipe ? "pipe:1" : "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stderr, bytes: pipe ? Buffer.concat(stdout) : Buffer.from(await fs.readFile("/out.raw")) };
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

for (const [options, named, samples] of [
  ["slope=0.5:level=1:400", "slope=0.5:level=1:freq=400", [5726, -3192, -1659, -826, 6436, -2919]],
  ["width=300:slope=0.5:500", "width=300:slope=0.5:freq=500", [3836, -1393, -1128, -815, 4050, -1274]],
  ["500:level=1:0.5", "freq=500:level=1:slope=0.5", [5241, -2872, -1455, -813, 5830, -2672]]
] as const) {
  it(`atilt binds mixed named and positional options ${options}`, async () => {
    const input = [Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768)];
    const control = await run(`atilt=${named}`, input, false, 8000);
    assert.equal(control.exitCode, 0, control.stderr);
    for (const complex of [false, true]) {
      const result = await run(`atilt=${options}`, input, complex, 8000);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.bytes, control.bytes);
      // Native FFmpeg 7.0.2 reference samples.
      assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => result.bytes.readInt16LE(i * 2)), samples);
    }
  });
}

// Native FFmpeg 7.0.2 signed 16-bit PCM at indices 0, 1, 2, 31, 32, 33.
for (const [order, rounded, samples] of [
  [2.5, 2, [7482, -5013, -1989, -847, 8646, -4644]],
  [3.5, 4, [5449, -3068, -1507, -816, 6092, -2852]],
  [3.1, 3, [5893, -3490, -1617, -821, 6651, -3238]]
] as const) {
  it(`atilt rounds order ${order} to ${rounded} with native PCM output`, async () => {
    const input = [Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768)];
    const control = await run(`atilt=freq=500:slope=0.5:order=${rounded}`, input, false, 8000);
    assert.equal(control.exitCode, 0, control.stderr);
    for (const positional of [false, true]) {
      const filter = positional ? `atilt=500:0.5:1000:${order}` : `atilt=freq=500:slope=0.5:order=${order}`;
      const result = await run(filter, input, positional, 8000);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.bytes, control.bytes);
      assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => result.bytes.readInt16LE(i * 2)), samples);
    }
  });
}

for (const option of ["freq=19", "freq=192001", "slope=1.1", "slope=-1.1", "width=99", "width=10001",
  "order=1", "order=31", "order=1.9", "order=30.1", "level=-1", "level=4.1", "slope=NaN", "freq=", "unknown=1"]) {
  it(`atilt rejects ${option} without replacing output`, async () => {
    const result = await run(`atilt=${option}`, [new Float64Array(4)]);
    assert.equal(result.exitCode, option === "unknown=1" ? 8 : option === "slope=NaN" || option === "freq=" ? 234 : 222);
    assert.ok(result.stderr.includes("atilt:"), result.stderr);
    assert.equal(result.bytes.toString(), "KEEP");
  });
}

for (const options of [
  "freq=500:slope=1/2",
  "freq=0.5k:slope=0.5",
  "freq=250*2:slope=0.5",
  "freq=0x1f4:slope=0.5",
  "freq=5e2:slope=500m:width=1k:order=10/2:level=1",
  "0.5k:1/2:500*2:2+3:2/2"
]) {
  it(`atilt evaluates numeric options ${options}`, async () => {
    const input = [Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768)];
    const control = await run("atilt=freq=500:slope=0.5", input, false, 8000);
    const result = await run(`atilt=${options}`, input, false, 8000);
    assert.equal(control.exitCode, 0, control.stderr);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.bytes, control.bytes);
    // Native FFmpeg 7.0.2 samples from the 8 kHz impulse fixture.
    assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => result.bytes.readInt16LE(i * 2)),
      [5241, -2872, -1455, -813, 5830, -2672]);
  });
}

for (const option of [
  "freq=0b111110100", "freq=0o764", "freq=0.019k", "freq=193k",
  "slope=3/2", "width=99/1", "order=31/1", "level=5/1", "freq=500garbage"
]) {
  it(`atilt rejects invalid numeric option ${option} without replacing output`, async () => {
    const result = await run(`atilt=${option}`, [new Float64Array(4)]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("atilt:"), result.stderr);
    assert.equal(result.bytes.toString(), "KEEP");
  });
}

// Native FFmpeg 7.0.2 process statuses for the same 8 kHz WAV fixture.
for (const [option, exitCode] of [["freq=19", 222], ["freq=oops", 234], ["bogus=5", 8], ["freq=20", 0]] as const) {
  it(`atilt preserves native status ${exitCode} for ${option} and emits PCM only on success`, async () => {
    const input = [Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768)];
    for (const complex of [false, true]) {
      const result = await run(`atilt=${option}`, input, complex, 8000, true);
      assert.equal(result.exitCode, exitCode, result.stderr);
      if (exitCode === 0) {
        assert.deepEqual(result.bytes, (await run("anull", input, complex, 8000, true)).bytes);
        assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => result.bytes.readInt16LE(i * 2)),
          [3000, -800, -800, -800, 3000, -800]);
      } else {
        assert.equal(result.bytes.length, 0);
        assert.ok(result.stderr.includes("atilt:"), result.stderr);
      }
    }
  });
}

for (const complex of [false, true]) {
  for (const options of ["freq=500:level=0.5", "500:0:1000:5:0.5"]) {
    it(`atilt accepts one trailing separator in ${complex ? "complex" : "simple"} options ${options}`, async () => {
      const input = [Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768)];
      const control = await run(`atilt=${options}`, input, complex, 8000);
      const result = await run(`atilt=${options}:`, input, complex, 8000);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.bytes, control.bytes);
      // Native FFmpeg 7.0.2 samples for the 8 kHz impulse fixture.
      assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => result.bytes.readInt16LE(i * 2)),
        [1500, -400, -400, -400, 1500, -400]);
    });
  }
  for (const options of ["freq=500:level=0.5::", "500:0:1000:5:0.5::", "500::1000:5:0.5:", "freq=500:level=:"]) {
    it(`atilt rejects empty values in ${complex ? "complex" : "simple"} options ${options}`, async () => {
      const result = await run(`atilt=${options}`, [new Float64Array(4)], complex, 8000);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("atilt:"), result.stderr);
      assert.equal(result.bytes.toString(), "KEEP");
    });
  }
}
