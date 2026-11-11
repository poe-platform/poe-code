import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];
const stop = "silenceremove=stop_periods=-1:stop_threshold=0.1:window=0";

async function run(filter: string, format = "framecrc", graph = false, samples = source) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let error = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
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
  return { result, error, output: volume.readFileSync("/out.raw") as Buffer };
}

function rows(output: Buffer) {
  return output.toString().split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim()));
}

// Native FFmpeg 7.0.2: each surviving input frame keeps its own packet boundary.
for (const timestamp of ["copy", "1", "write", "0", undefined]) {
  for (const graph of [false, true]) {
    it(`preserves silence-removal frame boundaries with timestamp=${timestamp ?? "default"} (graph=${graph})`, async () => {
      const { result, error, output } = await run(`asetnsamples=n=5:p=0,${stop}${timestamp === undefined ? "" : `:timestamp=${timestamp}`}`, "framecrc", graph);
      assert.equal(result.exitCode, 0, error);
      const pts = timestamp === "copy" || timestamp === "1" ? [0, 5, 10, 15, 20] : [0, 5, 6, 8, 10];
      assert.deepEqual(rows(output), [
        ["0", "0", "0", "5", "10", "0x0073004b"],
        ["0", "5", "5", "1", "2", "0x028c01b4"],
        ["0", String(pts[2]), String(pts[2]), "2", "4", "0x045d01ff"],
        ["0", String(pts[3]), String(pts[3]), "2", "4", "0x03e501ff"],
        ["0", String(pts[4]), String(pts[4]), "2", "4", "0x03e501ff"]
      ]);
    });
  }
}

for (const timestamp of ["copy", "write"]) {
  it(`keeps surviving PCM samples with timestamp=${timestamp}`, async () => {
    const { result, error, output } = await run(`asetnsamples=n=5:p=0,${stop}:timestamp=${timestamp}`, "s16le");
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
      [0, 0, 0, 0, 9000, -9000, 4000, -4000, 7000, -7000, 7000, -7000]);
  });
}

it("rejects invalid timestamp modes without overwriting output", async () => {
  const { result, output } = await run(`${stop}:timestamp=2`);
  assert.notEqual(result.exitCode, 0);
  assert.equal(output.toString(), "KEEP");
});

for (const timestamp of ["copy", "write"]) {
  it(`drops empty frames while preserving a shifted timeline with timestamp=${timestamp}`, async () => {
    const samples = source.map((value, i) => i === 10 || i === 11 ? 0 : value);
    const { result, error, output } = await run(
      `asetnsamples=n=5:p=0,asetpts=PTS+100,${stop}:timestamp=${timestamp},asetpts=PTS+10`, "framecrc", false, samples);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(rows(output).map(row => [Number(row[2]), Number(row[3])]),
      timestamp === "copy" ? [[110, 5], [115, 1], [125, 2], [130, 2]] : [[110, 5], [115, 1], [116, 2], [118, 2]]);
  });

  it(`keeps the original frame PTS after leading removal with timestamp=${timestamp}`, async () => {
    const samples = [0, 0, 0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 0, 0, 0, 0, 4000, -4000];
    const { result, error, output } = await run(
      `asetnsamples=n=5:p=0,asetpts=PTS+100,silenceremove=start_periods=1:start_threshold=0.1:window=0:timestamp=${timestamp}`,
      "framecrc", false, samples);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(rows(output).map(row => [Number(row[2]), Number(row[3])]),
      timestamp === "copy" ? [[105, 4], [110, 5], [115, 3]] : [[100, 4], [104, 5], [109, 3]]);
  });

  it(`emits no frames when leading removal discards all samples with timestamp=${timestamp}`, async () => {
    const { result, error, output } = await run(
      `asetnsamples=n=5:p=0,silenceremove=start_periods=1:start_threshold=0.1:window=0:timestamp=${timestamp}`,
      "framecrc", false, Array(15).fill(0));
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(rows(output), []);
  });

  it(`passes through original timing when no removal is requested with timestamp=${timestamp}`, async () => {
    const { result, error, output } = await run(`asetnsamples=n=5:p=0,asetpts=2*PTS,silenceremove=timestamp=${timestamp}`);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(rows(output).map(row => [Number(row[2]), Number(row[3])]), [[0, 5], [10, 5], [20, 5], [30, 5], [40, 5]]);
  });
}

// Native FFmpeg 7.0.2 advances its int64 NOPTS sentinel after the first output frame.
for (const graph of [false, true]) {
  const samples = [0, 0, 2300, 6400, 0, 0, 0, -4200, 5100, 0, 0, 0, 8200, 0, 0, 0];
  const trimmed = "fc08001900000000000098efec130000000000000820000000000000";
  const remove = "silenceremove=start_periods=1:window=0";
  for (const [filter, expected] of [
    [`asetpts=NAN,${remove}:timestamp=write,aselect='isnan(pts)'`, "fc080019"],
    [`asetpts=NAN,${remove}:timestamp=copy,aselect='isnan(pts)'`, trimmed],
    ["asetpts=NAN,silenceremove,aselect='isnan(pts)'", `00000000${trimmed}`],
    [`${remove}:timestamp=write,aselect='isnan(pts)'`, ""],
    [`asetpts=NAN,${remove}:timestamp=write,aselect='lt(pts,0)'`, trimmed.slice(8)]
  ]) {
    it(`matches native PCM after missing timestamps: ${filter} (graph=${graph})`, async () => {
      const { result, error, output } = await run(`asetnsamples=n=4:p=0,${filter}`, "s16le", graph, samples);
      assert.equal(result.exitCode, 0, error);
      assert.equal(output.toString("hex"), expected);
    });
  }

  it(`advances missing timestamps from the native sentinel without resetting to zero (graph=${graph})`, async () => {
    const { result, error, output } = await run(
      `asetnsamples=n=4:p=0,asetpts=NAN,${remove}:timestamp=write,ashowinfo`, "s16le", graph, samples);
    assert.equal(result.exitCode, 0, error);
    assert.equal(output.toString("hex"), trimmed);
    const frames = error.split("\n").filter(line => line.startsWith("[ashowinfo]"));
    assert.deepEqual(frames.map(line => [line.split(" pts:")[1]!.split(" ")[0],
      line.split(" nb_samples:")[1]!.split(" ")[0]]), [
      ["NOPTS", "2"], ["-9223372036854775806", "4"],
      ["-9223372036854775802", "4"], ["-9223372036854775798", "4"]
    ]);
  });
}
