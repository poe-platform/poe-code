import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const first = Array.from({ length: 11 }, (_, index) => (index + 1) * 100);
const second = [-10, -20, -30];

async function run(graph: string, inputs: number[][], output = "[out]", outputArgs = ["-f", "s16le"]) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  inputs.forEach((samples, index) => {
    const bytes = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, offset) => bytes.writeInt16LE(sample, offset * 2));
    volume.writeFileSync(`/${index}.raw`, bytes);
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...inputs.flatMap((_, index) =>
      ["-f", "s16le", "-ac", "1", "-ar", "1000", "-i", `/${index}.raw`]),
    "-filter_complex", graph, "-map", output, "-c:a", "pcm_s16le", ...outputArgs, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const [name, graph, inputs, expected] of [
  ["reversed input pads", "[1:a][0:a]concat=n=2:v=0:a=1[out]", [first, second], [...second, ...first]],
  ["forward input pads", "[0:a][1:a]concat=n=2:v=0:a=1[out]", [first, second], [...first, ...second]],
  ["repeated split branches", "[0:a]asplit[a][b];[a][b]concat=n=2:v=0:a=1[out]", [first], [...first, ...first]],
  ["filtered split branches and downstream filter", "[0:a]asplit[a][b];[a]volume=0.5[c];[b][c]concat=n=2:v=0:a=1,areverse[out]", [first], [...first, ...first.map(value => value / 2)].reverse()],
  ["unused input files", "[1:a][1:a]concat=n=2:v=0:a=1[out]", [first, second], [...second, ...second]],
  ["implicit input pads", "concat=n=2:v=0:a=1[out]", [first, second], [...first, ...second]]
] as const) {
  it(`concatenates audio in graph order: ${name}`, async () => {
    const result = await run(graph, inputs.map(samples => [...samples]));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, expected.length * 2);
    assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, index) => result.output.readInt16LE(index * 2)), expected);
  });
}

for (const [graph, output] of [
  ["[0:a][1:a]concat=n=3:v=0:a=1[out]", "[out]"],
  ["[0:a][1:a]concat=n=1:v=0:a=1[out]", "[out]"],
  ["[0:a][1:a]concat=n=2:v=0:a=1[out]", "[missing]"]
]) {
  it(`rejects invalid concat graph without replacing output: ${graph} ${output}`, async () => {
    const result = await run(graph!, [first, second], output);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString(), "keep");
  });
}

// Native FFmpeg 7.0.2 keeps packet gaps without inserting PCM silence.
for (const gaps of [false, true]) {
  const inputs = [145, 200].map((length, input) =>
    Array.from({ length }, (_, i) => ((i * (119 + 37 * input)) % 17000) - 7000));
  const graph = `[0:a]${gaps ? "asetpts=PTS*2" : "anull"}[a];[a][1:a]concat=n=2:v=0:a=1[out]`;
  it(`preserves concat packet timestamps, gaps=${gaps}`, async () => {
    const result = await run(graph, inputs, "[out]", ["-f", "framecrc"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const rows = result.output.toString().trim().split("\n").filter(line => !line.startsWith("#"));
    assert.deepEqual(rows.map(row => row.split(",").slice(1, 4).map(Number)),
      (gaps ? [0, 128, 256, 273, 337, 401, 465] : [0, 64, 128, 145, 209, 273, 337])
        .map((pts, i) => [pts, pts, [64, 64, 17, 64, 64, 64, 8][i]]));
  });
  it(`limits concat output by timestamps, gaps=${gaps}`, async () => {
    const result = await run(graph, inputs, "[out]", ["-t", "0.200", "-f", "s16le"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)),
      inputs.flat().slice(0, gaps ? 128 : 200));
  });
  it(`preserves concat PCM without filling gaps, gaps=${gaps}`, async () => {
    const result = await run(graph, inputs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)), inputs.flat());
  });
}

for (const marked of [0, 1]) {
  for (const framed of [false, true]) {
    it(`preserves concat frame tags from input ${marked}, framed=${framed}`, async () => {
      const inputs = [Array.from({ length: 11 }, (_, i) => i + 1),
        Array.from({ length: 9 }, (_, i) => i + 101)];
      const branches = inputs.map((_, i) => `[${i}:a]${framed ? "asetnsamples=3:0," : ""}` +
        (i === marked ? `ametadata=add:k:y${framed ? ":enable='eq(n,1)'" : ""}` : "anull") + `[f${i}]`).join(";");
      const result = await run(`${branches};[f0][f1]concat=n=2:v=0:a=1,ametadata=select:k:y[out]`, inputs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)),
        framed ? inputs[marked]!.slice(3, 6) : inputs[marked]);
    });
  }
}
