import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];
const trimmed = [0, 0, 0, 0, 9000, -9000, 4000, -4000, 7000, -7000, 7000, -7000];
const silenceFilter = "silenceremove=stop_periods=-1:stop_threshold=0.1:window=0:timestamp=write";

async function run(filter: string, format: string, graph: boolean, options: string[] = []) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out.raw") as Buffer;
}

for (const graph of [false, true]) {
  for (const remove of [false, true]) {
    const filter = `asetnsamples=n=5:p=0${remove ? `,${silenceFilter}` : ""}`;
    it(`matches native partial-frame timestamps and checksums (trim=${remove}, graph=${graph})`, async () => {
      const output = (await run(filter, "framecrc", graph)).toString();
      assert.ok(output.includes("#tb 0: 1/1000"));
      const rows = output.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
      // Native FFmpeg 7.0.2, including the untrimmed control.
      assert.deepEqual(rows, remove ? [
        ["0", "0", "0", "5", "10", "0x0073004b"],
        ["0", "5", "5", "1", "2", "0x028c01b4"],
        ["0", "6", "6", "2", "4", "0x045d01ff"],
        ["0", "8", "8", "2", "4", "0x03e501ff"],
        ["0", "10", "10", "2", "4", "0x03e501ff"]
      ] : [
        ["0", "0", "0", "5", "10", "0x0073004b"],
        ["0", "5", "5", "5", "10", "0x102c01b4"],
        ["0", "10", "10", "5", "10", "0x105701ff"],
        ["0", "15", "15", "5", "10", "0x03e501ff"],
        ["0", "20", "20", "5", "10", "0x0fdf01ff"]
      ]);
    });
    it(`preserves native PCM samples (trim=${remove}, graph=${graph})`, async () => {
      const output = await run(filter, "s16le", graph);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), remove ? trimmed : samples);
    });
  }
  for (const [suffix, options, expected] of [
    [",aselect=eq(n\\,1)", [], [-9000]],
    ["", ["-frames:a", "2"], trimmed.slice(0, 6)],
    [",asetnsamples=n=5:p=0", ["-frames:a", "2"], trimmed.slice(0, 10)]
  ] as const) {
    it(`uses trimmed frames downstream (${suffix}, ${options}, graph=${graph})`, async () => {
      const output = await run(`asetnsamples=n=5:p=0,${silenceFilter}${suffix}`, "s16le", graph, [...options]);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}

for (const [filter, frames] of [
  [`asetnsamples=3:0,${silenceFilter}`, [[0, 3], [3, 3], [6, 2], [8, 3], [11, 1]]],
  ["asetnsamples=5:0,silenceremove=start_periods=1:start_threshold=0.1:window=0", [[0, 1], [1, 5], [6, 5], [11, 5], [16, 5]]],
  [`asetnsamples=5:0,${silenceFilter}:start_periods=1:start_threshold=0.1`, [[0, 1], [1, 1], [2, 2], [4, 2], [6, 2]]],
  ["asetnsamples=5:0,silenceremove=stop_periods=1:stop_threshold=0.1:window=0", [[0, 5], [5, 1]]],
  ["asetnsamples=5:0,silenceremove=start_periods=1:start_threshold=1:window=0", []],
  ["asetnsamples=5:0,silenceremove", [[0, 5], [5, 5], [10, 5], [15, 5], [20, 5]]],
  [`asetnsamples=5:0,asetpts=2*PTS+10,${silenceFilter}`, [[10, 5], [15, 1], [16, 2], [18, 2], [20, 2]]],
  [`${silenceFilter},aselect=eq(n\\,0)`, [[0, 12]]]
] as const) {
  it(`preserves partial frames and omits empty frames: ${filter}`, async () => {
    const output = (await run(filter, "framecrc", false)).toString();
    const rows = output.split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()));
    assert.deepEqual(rows.map(row => [Number(row[2]), Number(row[3])]), frames);
  });
}
