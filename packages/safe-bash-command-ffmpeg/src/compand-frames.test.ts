import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, format: string, graph: boolean, samples = [15, -127, 500, -3000, 28000, -19003, 3001, 100]) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { stdout.push(b); } },
    stderr: { async write(b: Uint8Array) { stderr.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
  assert.equal(Buffer.concat(stderr).toString(), "");
  return Buffer.concat(stdout);
}

// Native FFmpeg 7.0.2 references; omit the version-dependent framecrc header.
for (const graph of [false, true]) {
  for (const [selection, expected] of [
    ["", "52730e00b8a585ffd4bfe1019033b5f46dc96469d8b778b81fc34b0b265c6000"],
    [",aselect=eq(n\\,0)", "52730e00b8a585ffd4bfe1019033b5f4"],
    [",aselect=eq(n\\,1)", "6dc96469d8b778b81fc34b0b265c6000"]
  ]) it(`compand lookahead PCM ${selection || "complete"} (${graph ? "graph" : "simple"})`, async () => {
    assert.equal((await run(`compand=delay=0.0005${selection}`, "s32le", graph)).toString("hex"), expected);
  });

  for (const [filter, expected] of [
    ["compand=delay=0.0005", [
      "0,          0,          0,        4,        8, 0x0e78041f",
      "0,          4,          4,        4,        8, 0x0e8602b6"
    ]],
    ["compand=delay=0", ["0,          0,          0,        8,       16, 0x3dd606d1"]],
    ["compand=delay=0.00001", ["0,          0,          0,        8,       16, 0x3dd606d1"]],
    ["asetnsamples=n=3:p=0,asetpts=PTS*2+80,compand=delay=0", [
      "0,         80,         80,        3,        6, 0x072e0276",
      "0,         86,         86,        3,        6, 0x0d6b03a5",
      "0,         92,         92,        2,        4, 0x020d00b6"
    ]],
    ["asetnsamples=n=3:p=0,asetpts=PTS*2+80,compand=delay=0.0005", [
      "0,         80,         80,        2,        4, 0x02430193",
      "0,         82,         82,        2,        4, 0x05e9028c",
      "0,         84,         84,        4,        8, 0x0e8602b6"
    ]]
  ] as const) it(`compand output frame CRCs: ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const output = await run(filter, "framecrc", graph);
    assert.deepEqual(output.toString().trim().split("\n").filter(line => !line.startsWith("#")), expected);
  });

  it(`compand drains input shorter than its lookahead (${graph ? "graph" : "simple"})`, async () => {
    const output = await run("compand=delay=1", "framecrc", graph, Array<number>(3000).fill(0));
    const frames = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
      .map(line => line.split(",").slice(1, 5).map(Number));
    assert.deepEqual(frames, [[0, 0, 2048, 4096], [2048, 2048, 952, 1904]]);
  });

  it(`compand drains at most 2048 samples per frame (${graph ? "graph" : "simple"})`, async () => {
    const output = await run("asetnsamples=n=1024:p=0,compand=delay=0.5", "framecrc", graph, Array<number>(5000).fill(0));
    const frames = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
      .map(line => line.split(",").slice(1, 5).map(Number));
    assert.deepEqual(frames, [[0, 0, 96, 192], [96, 96, 904, 1808], [1000, 1000, 2048, 4096], [3048, 3048, 1952, 3904]]);
  });
}
