import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];

async function run(filter: string, samples = source, channels = 1, graph = false, format = "s16le") {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let error = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", String(channels), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { error += new TextDecoder().decode(bytes); } }
  } as never);
  const output = volume.readFileSync("/out.raw") as Buffer;
  return { result, error, output };
}

for (const graph of [false, true]) {
  for (const [duration, prefix] of [["0", []], ["1ms", [0]], ["2ms", [9000, 0]],
    ["0.002", [9000, 0]], ["2000us", [9000, 0]]] as const) {
    it(`matches native start_silence=${duration} samples (graph=${graph})`, async () => {
      const { result, error, output } = await run(
        `silenceremove=start_periods=1:start_threshold=0.1:window=0:start_silence=${duration}`,
        source, 1, graph);
      assert.equal(result.exitCode, 0, error);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        [...prefix, ...source.slice(4)]);
    });
  }
}

for (const duration of ["-1ms", "bad", "Infinity", "2147.483648"]) {
  it(`rejects invalid start_silence=${duration} without replacing output`, async () => {
    const { result, output } = await run(`silenceremove=start_periods=1:start_silence=${duration}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}

// Native FFmpeg 7.0.2 reference: time base 1/1000, mono signed PCM16.
for (const [duration, count, checksum] of [
  ["0", 21, "0xaf6c07fc"], ["1ms", 22, "0xaf6c07fc"],
  ["2ms", 23, "0xbcc30847"], ["10ms", 26, "0xbcc30847"]
] as const) {
  it(`matches native framecrc with start_silence=${duration}`, async () => {
    const { result, error, output } = await run(
      `silenceremove=start_periods=1:start_threshold=0.1:window=0:start_silence=${duration}`,
      source, 1, false, "framecrc");
    assert.equal(result.exitCode, 0, error);
    const lines = output.toString().trim().split("\n");
    assert.ok(lines.includes("#tb 0: 1/1000"));
    assert.deepEqual(lines.filter(line => !line.startsWith("#")).map(line => line.split(",").map(v => v.trim())),
      [["0", "0", "0", String(count), String(count * 2), checksum]]);
  });
}

for (const [name, samples, channels, options, expected] of [
  ["unfilled queue", [9000, -9000, 0], 1, "start_periods=1:start_silence=2ms", [0, 9000, -9000, 0]],
  ["all silence", [0, 0, 0], 1, "start_periods=1:start_silence=2ms", []],
  ["disabled start", [0, 0, 9000, -9000], 1, "start_periods=0:start_silence=2ms", [0, 0, 9000, -9000]],
  ["multiple periods", [0, 0, 9000, 0, -9000, 0, 8000, -8000, 0], 1,
    "start_periods=2:start_duration=1ms:start_silence=3ms", [8000, -8000, -9000, -8000, 0]],
  ["stereo", [0, 100, 0, 200, 0, 300, 9000, 400, -9000, 500, 0, 600], 2,
    "start_periods=1:start_silence=2ms", [9000, 400, 0, 200, 9000, 400, -9000, 500, 0, 600]],
  ["stop trimming", [0, 0, 9000, -9000, 0, 0, 8000, -8000, 0], 1,
    "start_periods=1:start_silence=2ms:stop_periods=-1:stop_threshold=0.1", [9000, 9000, -9000, 8000, -8000]],
  ["window", [0, 0, 9000, -9000, 0, 0, 8000, -8000, 0], 1,
    "start_periods=1:start_silence=2ms:window=3ms", [9000, 0, 9000, -9000, 0, 0, 8000, -8000, 0]]
] as const) {
  it(`matches native leading retention with ${name}`, async () => {
    const { result, error, output } = await run(`silenceremove=start_threshold=0.1:window=0:${options}`, [...samples], channels);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

it("accepts positional start_silence", async () => {
  const { result, error, output } = await run("silenceremove=1:0:0.1:2ms:window=0");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), [9000, 0, ...source.slice(4)]);
});
