import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(5000 * 4);
for (let i = 0; i < 5000; i++) {
  input.writeInt16LE((i * 97) % 60001 - 30000, i * 4);
  input.writeInt16LE((i * 193 + 777) % 60001 - 30000, i * 4 + 2);
}

async function run(filter: string, graph: boolean, inputBytes = input) {
  const fs = Volume.fromJSON({ "/in.raw": inputBytes, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2 references include both channels and the complete EOF tail.
for (const graph of [false, true]) {
  for (const [expression, enabled] of [
    ["between(PI,3.14,3.15)", true],
    ["between(E,2.71,2.72)", true],
    ["between(PHI,1.61,1.62)", true],
    ["eq(PI,4)", false],
    ["eq(E,3)", false],
    ["eq(PHI,2)", false],
    ["1", true],
    ["0", false]
  ] as const) {
    it(`adelay evaluates ${expression} at its mathematical value (graph ${graph})`, async () => {
      const samples = [101, -901, 202, -802, 303, -703];
      const bytes = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
      const { result, stderr, output } = await run(`adelay=1S:enable='${expression}'`, graph, bytes);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
        enabled ? [0, -901, 101, -802, 202, -703, 303, 0] : [...samples, 0, 0]);
    });
  }
  for (const [filter, frames, hash] of [
    [
        "adelay=0S|23S:enable=0",
        5023,
        "c87ec09f8e8644c713b991a2cf47f1faca204ac90c5eb1078fe731874499a033"
    ],
    [
        "adelay=0S|23S:enable=1",
        5023,
        "e36a6a057bcf42dcc4c884203cf82668a6bbe633318a8a2b2088f848973c4ea6"
    ],
    [
        "adelay=0S|23S:enable='gte(t,0.3)'",
        5023,
        "34788b89c9069b9d4ff077c81de3fbd5cb98af5be5d905ba83a18eef3635f779"
    ],
    [
        "adelay=0S|23S:enable='lt(t,0.3)'",
        5023,
        "b7d97dbc13fdf4a0d931dd74bd7ce4f179c86d119883e33d868bafb7937368a3"
    ],
    [
        "adelay=0S|23S:enable='mod(n,2)'",
        5023,
        "0c68845d790dac2005979857fab0bd8a7f78a5f5a7ccfbe9643c36322ed29cb9"
    ],
    [
        "asetnsamples=n=128:p=0,adelay=0S|23S:enable='mod(n,2)'",
        5023,
        "3095649571f6f6a2f59ec49e912e4b6a0b5e0d578762318cd5dd9c7e1cfbbe87"
    ],
    [
        "asetpts=PTS+2400,adelay=0S|23S:enable='gte(t,0.3)'",
        5023,
        "e36a6a057bcf42dcc4c884203cf82668a6bbe633318a8a2b2088f848973c4ea6"
    ],
    [
        "adelay=100S|123S:enable=0",
        5123,
        "7308859c75924b93f350933235ba537d97507c2b571010a7ab7d14cd922cf65a"
    ],
    [
        "adelay=100S|123S:enable='gte(t,0.3)'",
        5123,
        "68a1967ee4a011cc02b2dec5ff1e91d65d8c3890c87cf9dc0bdcd2567be1e198"
    ],
    [
        "adelay=3000S|5500S:enable='mod(n,2)'",
        10500,
        "b50dd89bd305d12b0d57abaf2d52a8be67b7a43bb9508cf2cb681c1a15501863"
    ],
    [
        "adelay=0S|23S:enable='gte(t,0.3)',volume=n:eval=frame",
        5023,
        "da28497cd5589d3953f79f5eba0a955598ebacd406a0b97e0498744ef0be0c24"
    ]
] as const) {
    it(`adelay timeline matches native PCM: ${filter} (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, frames * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "adelay=0S|23S:enable=0") {
        assert.deepEqual(output, Buffer.concat([input, Buffer.alloc(23 * 4)]));
      }
      if (filter === "adelay=0S|23S:enable='gte(t,0.3)'") {
        assert.deepEqual(output.subarray(0, 2048 * 4), input.subarray(0, 2048 * 4));
      }
    });
  }
  for (const enable of ["0.25", "-1", "gte(t\\,0.3)"]) {
    it(`adelay accepts enable=${enable} (graph ${graph})`, async () => {
      const reference = enable === "0.25" ? "0" : enable === "-1" ? "1" : "'gte(t,0.3)'";
      const expected = await run(`adelay=0S|23S:enable=${reference}`, graph);
      const actual = await run(`adelay=0S|23S:enable=${enable}`, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }
  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`rejects invalid adelay enable=${enable} before replacing output (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(`adelay=0S|23S:enable=${enable}`, graph);
      assert.equal(result.exitCode, 1, stderr);
      assert.ok(stderr.includes("adelay"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
