import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 13 }, (_, i) => i + 1);

async function run(graph: string, channels = 1, inputSamples = samples) {
  const input = Buffer.alloc(inputSamples.length * channels * 2);
  inputSamples.forEach((sample, i) => {
    for (let channel = 0; channel < channels; channel++) {
      input.writeInt16LE(channel === 0 ? sample : -sample, (i * channels + channel) * 2);
    }
  });
  const volume = Volume.fromJSON({});
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "info", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
      "-i", "pipe:0", "-filter_complex", graph, "-map", "[out]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; })(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  const output = Buffer.concat(chunks);
  return { result, stderr, output: Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)) };
}

// FFmpeg 7.0.2 emits [1..5] on the first branch and [6..13] on the second.
for (const option of ["samples=5", "timestamps=0.000625"]) {
  for (const prefix of [true, false]) {
    for (const channels of [1, 2]) {
      it(`routes asegment ${option} ${prefix ? "prefix" : "reversed suffix"} (${channels} channels)`, async () => {
        const graph = `[0:a]asegment=${option}[a][b];` +
          (prefix ? "[b]anullsink;[a]anull[out]" : "[a]anullsink;[b]areverse[out]");
        const { result, stderr, output } = await run(graph, channels);
        assert.equal(result.exitCode, 0, stderr);
        const expected = prefix ? samples.slice(0, 5) : samples.slice(5).reverse();
        assert.deepEqual(output, expected.flatMap(sample => channels === 1 ? [sample] : [sample, -sample]));
      });
    }
  }
}

for (const [clock, cut] of [[4000, 3], [16000, 16]] as const) {
  for (const option of ["timestamps=0.000625", "samples=5"]) {
    for (const prefix of [true, false]) {
      it(`uses clock 1/${clock} for ${option} ${prefix ? "prefix" : "suffix"}`, async () => {
        const input = Array.from({ length: 16 }, (_, i) => i + 1);
        const { result, stderr, output } = await run(
          `[0:a]asettb=1/${clock},asegment=${option}[a][b];` +
          (prefix ? "[b]anullsink;[a]anull[out]" : "[a]anullsink;[b]anull[out]"), 1, input
        );
        assert.equal(result.exitCode, 0, stderr);
        const boundary = option.startsWith("samples") ? 5 : cut;
        assert.deepEqual(output, prefix ? input.slice(0, boundary) : input.slice(boundary));
      });
    }
  }
}

for (const [filter, expected] of [
  ["atrim=start_sample=5,areverse", samples.slice(5).reverse()],
  ["asplit[a][b];[a]anullsink;[b]areverse", [...samples].reverse()]
] as const) {
  it(`preserves the ${filter} control`, async () => {
    const { result, stderr, output } = await run(`[0:a]${filter}[out]`);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(output, expected);
  });
}

for (const [name, graph, expected] of [
  ["multiple sample points", "[0:a]asegment=samples=5|9[a][b][c];[a]anullsink;[c]anullsink;[b]anull[out]", samples.slice(5, 9)],
  ["multiple timestamps", "[0:a]asegment=timestamps=0.000625|0.001125[a][b][c];[a]anullsink;[c]anullsink;[b]anull[out]", samples.slice(5, 9)],
  ["relative sample point", "[0:a]asegment=samples=5|+4[a][b][c];[a]anullsink;[c]anullsink;[b]anull[out]", samples.slice(5, 9)],
  ["named instance and upstream reverse", "[0:a]areverse,asegment@cut=samples=5[a][b];[b]anullsink;[a]anull[out]", [...samples].reverse().slice(0, 5)],
  ["upstream frame boundaries", "[0:a]asetnsamples=n=4:p=0,asegment=samples=5[a][b];[a]anullsink;[b]areverse[out]", samples.slice(5).reverse()],
  ["zero split prefix", "[0:a]asegment=samples=0[a][b];[b]anullsink;[a]anull[out]", []],
  ["zero split suffix", "[0:a]asegment=samples=0[a][b];[a]anullsink;[b]anull[out]", samples],
  ["split beyond input", "[0:a]asegment=samples=20[a][b];[a]anullsink;[b]anull[out]", []],
  ["both branches feeding a downstream filter", "[0:a]asegment=samples=5[a][b];[b][a]concat=n=2:v=0:a=1[out]", [...samples.slice(5), ...samples.slice(0, 5)]]
] as const) {
  it(`handles asegment ${name}`, async () => {
    const { result, stderr, output } = await run(graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(output, expected);
  });
}

for (const filter of ["asegment", "asegment=samples=", "asegment=samples=bad", "asegment=timestamps=bad",
  "asegment=samples=5:timestamps=0.000625", "asegment=samples=5|", "asegment=unknown=5"]) {
  it(`rejects invalid ${filter} without output`, async () => {
    const { result, output } = await run(`[0:a]${filter}[a][b];[a]anullsink;[b]anull[out]`);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(output, []);
  });
}

it("rejects asegment output label counts that do not match its segments", async () => {
  const { result, output } = await run("[0:a]asegment=samples=5[out]");
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(output, []);
});
