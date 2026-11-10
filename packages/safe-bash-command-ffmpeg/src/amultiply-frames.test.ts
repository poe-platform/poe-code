import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, suffix = "", format = "s16le", options: string[] = [], count = 11, rates = [1000, 1000]) {
  const input = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) input.writeInt16LE((i + 1) * 100, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input });
  const inputArgs = rates.flatMap(rate => ["-f", "s16le", "-ac", "1", "-ar", String(rate), "-i", "/in.raw"]);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...inputArgs, "-filter_complex", `${graph}amultiply${suffix}[out]`,
      "-map", "[out]", ...options, "-c:a", "pcm_s16le", "-f", format, "/out"],
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
  const output = volume.readFileSync("/out") as Buffer;
  return format === "s16le" ? Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2))
    : output.toString().split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()));
}

const splitReverse = "[0:a]asetnsamples=n=4:p=0,asplit[a][b];[b]areverse[r];[a][r]";
const independent = "[0:a]asetnsamples=n=4:p=0[a];[1:a]asetnsamples=n=4:p=0,anull[r];[a][r]";

// Native FFmpeg 7.0.2: reversal drains the shared source and queues the other split branch.
for (const [graph, pcm, sizes] of [
  [splitReverse, [3, 6, 8, 10, 11, 11, 11, 10, 8, 6, 3], [3, 4, 4]],
  [independent, [0, 1, 3, 5, 8, 11, 15, 20, 25, 31, 37], [4, 4, 3]],
  ["[0:a]asetnsamples=4:0[a];[1:a]asetnsamples=4:0,areverse[r];[a][r]",
    [3, 6, 8, 10, 11, 11, 11, 10, 8, 6, 3], [3, 1, 3, 1, 3]],
  ["[0:a]asetnsamples=4:0,asplit[a][b];[b]areverse[r];[r][a]",
    [3, 6, 8, 10, 11, 11, 11, 10, 8, 6, 3], [3, 4, 4]],
  ["[0:a]asetnsamples=4:0[a];[1:a]asetnsamples=3:0[r];[a][r]",
    [0, 1, 3, 5, 8, 11, 15, 20, 25, 31, 37], [3, 1, 2, 2, 1, 2]]
] as const) {
  it(`amultiply preserves native PCM and frame selection: ${graph}`, async () => {
    assert.deepEqual(await run(graph), pcm);
    let start = 0;
    for (const [n, size] of sizes.entries()) {
      assert.deepEqual(await run(graph, `,aselect=eq(n\\,${n})`), pcm.slice(start, start + size));
      start += size;
    }
    assert.deepEqual(await run(graph, `,aselect=eq(n\\,${sizes.length})`), []);
  });
}

it("amultiply retains split/reverse frame timestamps, durations and checksums", async () => {
  assert.deepEqual(await run(splitReverse, "", "framecrc"), [
    ["0", "0", "0", "3", "6", "0x003a0011"],
    ["0", "3", "3", "4", "8", "0x00d4002b"],
    ["0", "7", "7", "4", "8", "0x009e001b"]
  ]);
});

it("amultiply passes retained frames through volume and output frame limits", async () => {
  assert.deepEqual(await run(splitReverse, ",aselect=eq(n\\,1),volume=0.5"), [5, 5, 5, 5]);
  assert.deepEqual(await run(splitReverse, "", "s16le", ["-frames:a", "2"]), [3, 6, 8, 10, 11, 11, 11]);
});

for (const [rates, frames] of [
  [[1000, 2000], [[0, 24], [24, 16], [40, 4], [44, 4], [48, 16]]],
  [[2000, 1000], [[0, 40], [40, 8], [48, 32], [80, 40], [120, 8]]]
] as const) {
  it(`amultiply retains resampled frame boundaries at ${rates}`, async () => {
    const output = await run("[0:a]asetnsamples=40:0[a];[1:a]asetnsamples=40:0[b];[a][b]",
      "", "framecrc", [], 128, [...rates]);
    assert.deepEqual((output as string[][]).map(row => [Number(row[2]), Number(row[3])]), frames);
  });
}
