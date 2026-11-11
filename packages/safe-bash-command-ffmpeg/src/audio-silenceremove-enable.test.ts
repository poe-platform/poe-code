import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];

async function run(filter: string, format = "s16le", graph = false) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => input.writeInt16LE(value, i * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
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
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2: identical 1 kHz PCM input, five-sample frames.
const cases = [
  { enable: "gte(t\\,0.012)", samples: [...samples.slice(0, 15), 7000, -7000, 7000, -7000],
    rows: [[0, 5, "0x0073004b"], [5, 5, "0x102c01b4"], [10, 5, "0x105701ff"], [15, 2, "0x03e501ff"], [17, 2, "0x03e501ff"]] },
  { enable: "0", samples,
    rows: [[0, 5, "0x0073004b"], [5, 5, "0x102c01b4"], [10, 5, "0x105701ff"], [15, 5, "0x03e501ff"], [20, 5, "0x0fdf01ff"]] },
  { enable: "1", samples: [...samples.slice(0, 6), 4000, -4000, 7000, -7000, 7000, -7000],
    rows: [[0, 5, "0x0073004b"], [5, 1, "0x028c01b4"], [6, 2, "0x045d01ff"], [8, 2, "0x03e501ff"], [10, 2, "0x03e501ff"]] }
] as const;

for (const expected of cases) for (const graph of [false, true]) {
  for (const format of ["s16le", "framecrc"]) {
    it(`silenceremove enable=${expected.enable} matches native ${format} (graph=${graph})`, async () => {
      const { result, stderr, output } = await run(
        `asetnsamples=n=5:p=0,silenceremove=stop_periods=-1:stop_threshold=0.1:window=0:enable=${expected.enable}`,
        format, graph);
      assert.equal(result.exitCode, 0, stderr);
      if (format === "s16le") {
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected.samples);
      } else {
        assert.ok(output.toString().includes("#tb 0: 1/1000"));
        const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()));
        assert.deepEqual(rows, expected.rows.map(([pts, duration, crc]) =>
          ["0", String(pts), String(pts), String(duration), String(duration * 2), crc]));
      }
    });
  }
}

for (const enable of ["PI", "E", "PHI", "eq(PI\\,3.141592653589793)", "eq(E\\,2.718281828459045)", "eq(PHI\\,1.618033988749895)"]) {
  for (const graph of [false, true]) {
    it(`silenceremove enable=${enable} matches enabled native PCM (graph=${graph})`, async () => {
      const { result, stderr, output } = await run(
        `asetnsamples=n=5:p=0,silenceremove=stop_periods=-1:stop_threshold=0.1:window=0:enable=${enable}`,
        "s16le", graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), cases[2].samples);
    });
  }
}

for (const enable of ["", "unknown", "gte(t,)"]) {
  it(`rejects invalid silenceremove enable=${enable} before replacing output`, async () => {
    const { result, stderr, output } = await run(`silenceremove=enable='${enable}'`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("silenceremove enable"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}

// Native FFmpeg 7.0.2 expectations also cover detector state while disabled.
for (const [filter, expected] of [
  ["silenceremove=stop_periods=-1:stop_threshold=0.1:window=0:enable='gte(n,3)'", cases[0].samples],
  ["asetpts=PTS+20,silenceremove=stop_periods=-1:stop_threshold=0.1:window=0:enable='gte(t,0.032)'", cases[0].samples],
  ["silenceremove=stop_periods=1:stop_threshold=0.1:window=0:enable='gte(n,2)'", samples.slice(0, 12)],
  ["silenceremove=stop_periods=-1:stop_threshold=0.1:window=0.003:enable='mod(n,2)'",
    [...samples.slice(0, 8), ...samples.slice(10, 15), ...samples.slice(18)]],
  ["silenceremove=start_periods=1:start_threshold=0.1:window=0:enable='gte(n,1)'", samples],
  ["silenceremove=start_periods=1:start_threshold=0.1:window=0:enable='not(mod(n,2))'", samples.slice(4)],
  ["silenceremove=start_periods=1:start_threshold=0.1:start_duration=0.004:stop_periods=-1:stop_threshold=0.1:window=0:enable='not(mod(n,2))'",
    [...samples.slice(5, 10), ...samples.slice(15, 22)]],
  ["silenceremove=start_periods=1:start_threshold=0.1:start_silence=0.003:window=0:enable='gte(n,1)'", samples],
  ["silenceremove=stop_periods=-1:stop_threshold=0.1:stop_silence=0.002:window=0:enable='mod(n,2)'",
    [...samples.slice(0, 8), ...samples.slice(10, 17), ...samples.slice(18)]]
] as const) for (const graph of [false, true]) {
  it(`matches native state transitions for ${filter} (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(`asetnsamples=n=5:p=0,${filter}`, "s16le", graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
