import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 1000, 2000, 0, 3000, 4000];

async function run(filter: string, graph: boolean) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
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


// Native FFmpeg 7.0.2 drops tags on rebuilt frames, preserving forwarded frames only.
for (const graph of [false, true]) {
  for (const [remove, before, expected] of [
    ["silenceremove=stop_periods=-1:window=0", true, []],
    ["silenceremove=start_periods=1:window=0", true, [2000, 0, 3000, 4000]],
    ["silenceremove=stop_periods=-1:window=0", false, [0, 1000, 2000, 3000, 4000]],
    ["silenceremove=start_periods=1:window=0", false, [1000, 2000, 0, 3000, 4000]],
    ["silenceremove", true, samples],
    ["silenceremove=start_periods=1:stop_periods=-1:window=0", true, []],
    ["silenceremove=start_periods=2:window=0", true, []]
  ] as const) {
    it(`matches native frame tags: ${remove}, before=${before}, graph=${graph}`, async () => {
      const tag = "ametadata=add:stamp:hi";
      const filter = `asetnsamples=n=2:p=0,${before ? `${tag},${remove}` : `${remove},${tag}`},ametadata=select:stamp:hi`;
      const output = await run(filter, graph);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}

for (const graph of [false, true]) {
  it(`keeps tags aligned when leading frames are removed (graph=${graph})`, async () => {
    const output = await run("asetnsamples=n=1:p=0,ametadata=add:stamp:hi:enable=eq(n\\,2),silenceremove=start_periods=1:window=0,ametadata=select:stamp:hi", graph);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), [2000]);
  });
}
