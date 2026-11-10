import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [0, 0, 0, 0, 9000, 9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0,
  0, 0, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 0, 0, 0];

async function run(filter: string, format = "s16le", graph = false) {
  const input = Buffer.alloc(source.length * 2);
  source.forEach((value, index) => input.writeInt16LE(value, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  return volume.readFileSync("/out.raw") as Buffer;
}

// Native FFmpeg 7.0.2 results, including signed samples and repeated equal peaks.
for (const detection of ["ptp", "4", "rms"]) {
  for (const graph of [false, true]) {
    it(`matches native silenceremove detection=${detection} samples (graph=${graph})`, async () => {
      const output = await run(
        `silenceremove=stop_periods=-1:stop_threshold=0.12:window=5ms:detection=${detection}`, "s16le", graph);
      const actual = Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
      assert.deepEqual(actual, detection === "rms"
        ? [0, 0, 0, 0, 9000, 9000, 0, 0, 0, 0, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 0, 0, 0]
        : [0, 0, 0, 0, 9000, 9000, 0, 0, 0, 4000, -4000, 0, 0, 0, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000]);
    });
  }

  it(`matches native silenceremove detection=${detection} timestamps and checksum`, async () => {
    const output = await run(
      `silenceremove=stop_periods=-1:stop_threshold=0.12:window=5ms:detection=${detection}`, "framecrc");
    const lines = output.toString().trim().split("\n");
    assert.ok(lines.includes("#tb 0: 1/1000"));
    assert.deepEqual(lines.filter(line => !line.startsWith("#")).map(line => line.split(",").map(value => value.trim())),
      [["0", "0", "0", detection === "rms" ? "23" : "25", detection === "rms" ? "46" : "50",
        detection === "rms" ? "0x60b80514" : "0x8e240786"]]);
  });
}

for (const [options, expected] of [
  ["start_periods=1:start_threshold=0.3:window=5ms", source.slice(11)],
  ["start_periods=1:start_threshold=0.12:window=0", source.slice(4)],
  ["stop_periods=-1:stop_threshold=0.12:window=0", [...source.slice(0, 6), ...source.slice(10, 12), ...source.slice(18, 29)]]
] as const) {
  it(`matches native peak-to-peak ${options}`, async () => {
    const output = await run(`silenceremove=detection=ptp:${options}`);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
