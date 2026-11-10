import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000,
  0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];

async function run(samples: number[], options: string, format = "s16le", graph = false) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const errors: Uint8Array[] = [];
  const filter = `silenceremove=${options}`;
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
  return { result, output: volume.readFileSync("/out.raw") as Buffer, error: Buffer.concat(errors).toString() };
}

// Exact PCM and framecrc rows captured from FFmpeg 7.0.2 at 1000 Hz.
for (const [retention, expected, checksum] of [
  ["0", [0, 0, 0, 0, 9000, -9000, 4000, -4000, 7000, -7000, 7000, -7000], "0x3fa407fc"],
  ["1ms", [0, 0, 0, 0, 9000, -9000, 0, 4000, -4000, 0, 7000, -7000, 7000, -7000, 0], "0x5b9607fc"],
  ["2ms", [0, 0, 0, 0, 9000, -9000, 0, 0, 4000, -4000, 0, 0, 7000, -7000, 7000, -7000, 0, 0], "0x778807fc"]
] as const) {
  for (const graph of [false, true]) {
    for (const format of ["s16le", "framecrc"]) {
      it(`retains stop_silence=${retention} in ${format} (graph=${graph})`, async () => {
        const { result, output, error } = await run(source,
          `stop_periods=-1:stop_threshold=0.1:window=0:stop_silence=${retention}`, format, graph);
        assert.equal(result.exitCode, 0, error);
        if (format === "s16le") {
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
        } else {
          assert.ok(output.toString().includes("#tb 0: 1/1000\n"));
          const rows = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
            .map(line => line.split(",").map(value => value.trim()));
          assert.deepEqual(rows, [["0", "0", "0", String(expected.length), String(expected.length * 2), checksum]]);
        }
      });
    }
  }
}

// Nonzero samples below the threshold distinguish which silence samples are retained.
const quietSource = [0, 0, 0, 0, 9000, -9000, 100, 200, 300, 400, 4000, -4000,
  500, 600, 700, 800, 900, 1000, 7000, -7000, 7000, -7000, 1100, 1200, 1300];
for (const [options, expected] of [
  ["stop_periods=-1:stop_silence=0.002", [0, 0, 0, 0, 9000, -9000, 200, 300, 4000, -4000, 600, 700, 7000, -7000, 7000, -7000, 1200, 1300]],
  ["stop_periods=-1:stop_silence=2000us:stop_duration=2ms", [0, 0, 0, 0, 9000, -9000, 100, 200, 400, 4000, -4000, 500, 600, 800, 900, 7000, -7000, 7000, -7000, 1100, 1200]],
  ["stop_periods=-1:stop_silence=4ms", [0, 0, 0, 0, 9000, -9000, 200, 300, 400, 4000, -4000, 600, 700, 800, 900, 7000, -7000, 7000, -7000, 1200, 1300]],
  ["stop_periods=1:stop_silence=4ms", [0, 0, 0, 0, 9000, -9000, 200, 300, 400, 4000]],
  ["stop_periods=-2:stop_silence=2ms", [0, 0, 0, 0, 9000, -9000, 100, 300, 400, 4000, -4000, 500, 700, 800, 7000, -7000, 7000, -7000, 1100, 1300]],
  ["0:0:0:0:any:-1:0:0.1:2ms", [0, 0, 0, 0, 9000, -9000, 200, 300, 4000, -4000, 600, 700, 7000, -7000, 7000, -7000, 1200, 1300]],
  ["stop_periods=0:stop_silence=2ms", quietSource]
] as const) {
  it(`matches native retained samples for ${options}`, async () => {
    const { result, output, error } = await run(quietSource, `${options}:stop_threshold=0.1:window=0`);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const retention of ["-1ms", "bad", "Infinity", "2147.483648", ""]) {
  it(`rejects invalid stop_silence=${retention} without replacing output`, async () => {
    const { result, output } = await run(source, `stop_periods=-1:stop_silence=${retention}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}
