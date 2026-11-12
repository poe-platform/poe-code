import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const first = [1, 2, 3, 4, 5, 6, 7, 8];
const second = [101, 102, 103, 104];

async function run(graph: string, map: string, format = "s16le") {
  const volume = Volume.fromJSON({});
  for (const [index, samples] of [first, second].entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  }
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex", graph,
      "-map", `[${map}]`, "-c:a", "pcm_s16le", "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(stdout) };
}

// Complete PCM16 output from native FFmpeg 7.0.2, including inter-segment silence.
for (const segments of [1, 2]) {
  for (const selected of ["x", "y"]) {
    const graph = `${"[0:a][1:a]".repeat(segments)}concat=n=${segments}:v=0:a=2[x][y];` +
      `[${selected === "x" ? "y" : "x"}]anullsink`;
    it(`keeps concat output ${selected} separate across ${segments} segments`, async () => {
      const result = await run(graph, selected);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = selected === "x" ? first : second;
      assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)),
        segments === 1 ? expected : [...expected, ...(selected === "y" ? [0, 0, 0, 0] : []), ...expected]);
    });
    it(`keeps concat output ${selected} timestamps across ${segments} segments`, async () => {
      const result = await run(graph, selected, "framecrc");
      assert.equal(result.exitCode, 0, result.stderr);
      const rows = result.output.toString().trim().split("\n").filter(line => !line.startsWith("#"));
      const frames = selected === "x" ? [[0, 0, 8]] : [[0, 0, 4]];
      if (segments === 2) {
        if (selected === "y") frames.push([4, 4, 4]);
        frames.push([8, 8, selected === "x" ? 8 : 4]);
      }
      assert.deepEqual(rows.map(row => row.split(",").slice(1, 4).map(Number)), frames);
    });
  }
}

it("preserves single-output concat", async () => {
  const result = await run("[0:a][1:a]concat=n=2:v=0:a=1[out]", "out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)),
    [...first, ...second]);
});

for (const [name, graph, expected] of [
  ["implicit inputs", "concat=n=1:v=0:a=2[x][y];[x]anullsink;[y]anull[out]", second],
  ["filtered inputs and output", "[1:a]areverse[b];[0:a][b][1:a][0:a]concat=n=2:v=0:a=2[x][y];[x]anullsink;[y]areverse[out]",
    [...first].reverse().concat([0, 0, 0, 0], second)],
  ["three streams", "[0:a][1:a][0:a][1:a][0:a][1:a]concat=n=2:v=0:a=3[x][y][z];[x]anullsink;[z]anullsink;[y]anull[out]",
    [...second, 0, 0, 0, 0, ...first]],
  ["microsecond output clock", "[0:a][1:a][0:a][1:a]concat=n=2:v=0:a=2[x][y];[x]anullsink;[y]aselect='eq(TB,1/1000000)*eq(pts,8000)'[out]",
    second],
  ["named concat instance", "[0:a][1:a]concat@join=1:0:2[x][out];[x]anullsink", second]
] as const) {
  it(`routes concat audio outputs with ${name}`, async () => {
    const result = await run(graph, "out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)), expected);
  });
}

for (const graph of [
  "[0:a][1:a]concat=n=1:v=0:a=2[out]",
  "[0:a][1:a]concat=n=2:v=0:a=2[out][y];[y]anullsink",
  "[0:a][1:a][0:a]concat=n=1:v=0:a=2[out][y];[y]anullsink",
  "[0:a][1:a]concat=n=1:v=0:a=2[out][y]"
]) {
  it(`rejects invalid multi-output concat graph: ${graph}`, async () => {
    const result = await run(graph, "out");
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.length, 0);
  });
}
