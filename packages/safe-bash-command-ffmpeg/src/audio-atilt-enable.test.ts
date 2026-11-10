import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768);
const tilt = "atilt=freq=500:slope=0.5";

async function run(filter: string, graph = false, channels = [input]) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  await fs.writeFile("/out.raw", new TextEncoder().encode("KEEP"));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stderr, bytes: Buffer.from(await fs.readFile("/out.raw")) };
}

for (const graph of [false, true]) {
  for (const enable of ["0", "0.25", "1", "-1"]) {
    it(`atilt constant enable=${enable} (graph ${graph})`, async () => {
      const expected = await run(Math.abs(Number(enable)) >= 0.5 ? tilt : "anull", graph);
      const actual = await run(`${tilt}:enable=${enable}`, graph);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.bytes, expected.bytes);
    });
  }

  for (const [prefix, enable] of [
    ["asetnsamples=32:0", "gte(n,1)"],
    ["asetnsamples=32:0", "gte(t,0.003)"],
    ["asetnsamples=32:0,asetpts=PTS+32", "gte(t,0.007)"]
  ]) {
    it(`atilt gates whole frames using ${prefix}: ${enable} (graph ${graph})`, async () => {
      const actual = await run(`${prefix},${tilt}:enable='${enable}'`, graph);
      const bypass = await run("anull", graph, [input.slice(0, 32)]);
      const filtered = await run(tilt, graph, [input.slice(32)]);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(bypass.exitCode, 0, bypass.stderr);
      assert.equal(filtered.exitCode, 0, filtered.stderr);
      assert.deepEqual(actual.bytes, Buffer.concat([bypass.bytes, filtered.bytes]));
      // Native FFmpeg 7.0.2 reference at indices 0, 1, 2, 31, 32, 33.
      assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => actual.bytes.readInt16LE(i * 2)),
        [3000, -800, -800, -800, 5241, -2872]);
    });
  }

  it(`atilt freezes every stage and channel across bypassed frames (graph ${graph})`, async () => {
    const channels = [input.slice(0, 110), Float64Array.from(input.slice(0, 110), value => -value / 2)];
    const enabled = channels.map(channel => Float64Array.from([...channel.slice(32, 64), ...channel.slice(96)]));
    const filtered = await run(tilt, graph, enabled);
    const bypass = await run("anull", graph, channels);
    const actual = await run(`asetnsamples=32:0,${tilt}:enable='mod(n,2)'`, graph, channels);
    assert.equal(filtered.exitCode, 0, filtered.stderr);
    assert.equal(bypass.exitCode, 0, bypass.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.bytes, Buffer.concat([
      bypass.bytes.subarray(0, 32 * 4), filtered.bytes.subarray(0, 32 * 4),
      bypass.bytes.subarray(64 * 4, 96 * 4), filtered.bytes.subarray(32 * 4)
    ]));
  });

  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`atilt rejects invalid enable=${enable} without replacing output (graph ${graph})`, async () => {
      const result = await run(`${tilt}:enable=${enable}`, graph);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("atilt"), result.stderr);
      assert.equal(result.bytes.toString(), "KEEP");
    });
  }
}
