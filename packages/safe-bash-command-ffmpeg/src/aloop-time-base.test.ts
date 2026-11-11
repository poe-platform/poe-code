import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 29 }, (_, i) => i + 1);
const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)] });

// FFmpeg 7.0.2-static: [PTS in 1/8000 units, sample count].
for (const graph of [false, true]) {
  for (const [filter, options, frames] of [
    ["asettb=1/3000,aloop=1:4:0", [], [[0, 4], [5, 4], [11, 25]]],
    ["asettb=1/3000,aloop=2:4:0", [], [[0, 4], [5, 4], [11, 4], [16, 25]]],
    ["asettb=1/1000,aloop=2:4:0", [], [[0, 4], [8, 4], [16, 4], [24, 25]]],
    ["asettb=1/16000,aloop=2:4:0", [], [[0, 4], [4, 4], [8, 4], [12, 25]]],
    ["asetnsamples=3:0,asettb=1/3000,aloop=2:4:0", [],
      [[0, 4], [5, 4], [11, 4], [16, 2], [19, 3], [21, 3], [24, 3], [27, 3], [29, 3], [32, 3], [35, 3], [37, 2]]],
    ["asettb=1/3000,aloop=1:4:2", [], [[0, 4], [8, 2], [8, 2], [13, 4], [19, 21]]],
    ["asettb=1/3000,aloop=-1:4:0", ["-frames:a", "4"], [[0, 4], [5, 4], [11, 4], [16, 4]]],
    ["asettb=1/3000,aloop=-1:4:0", ["-t", "0.002"], [[0, 4], [5, 4], [11, 4]]],
    ["asettb=1/3000,aloop=-1:3:0", ["-t", "0.002"], [[0, 3], [3, 3], [5, 3], [8, 3], [11, 3], [13, 3]]],
    ["asettb=1/3000,aloop=-1:4:0,aselect='gte(t,0.0006)'", ["-frames:a", "3"], [[5, 4], [11, 4], [16, 4]]]
  ] as const) {
    it(`aloop rounds each frame in the link time base: ${filter} ${options.join(" ")} (${graph ? "graph" : "simple"})`, async () => {
      const output = await run(filter, graph, "framecrc", options);
      const packets = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").slice(1, 5).map(Number));
      assert.deepEqual(packets, frames.map(([pts, count]) => [pts, pts, count, count * 2]));
    });
  }

  for (const loop of [2, -1]) {
    it(`aloop rounds the final short frame of every replay (loop=${loop}, graph=${graph})`, async () => {
      const largeInput = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 1100 }, (_, i) => (i + 1) / 32768)] });
      const output = await run(`asettb=1/3000,aloop=${loop}:1025:0`, graph, "framecrc",
        loop === -1 ? ["-frames:a", "8"] : [], largeInput);
      const frames = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").slice(2, 4).map(Number));
      assert.deepEqual(frames, [[0, 1024], [1024, 1], [1024, 1024], [2048, 1], [2048, 1024], [3072, 1],
        ...(loop === -1 ? [[3072, 1024], [4096, 1]] : [[3072, 75]])]);
    });
  }

  for (const select of [false, true]) {
    it(`aloop preserves PCM with rounded replay times (select=${select}, graph=${graph})`, async () => {
      const output = await run(`asettb=1/3000,aloop=1:4:0${select ? ",aselect='gte(t,0.0006)'" : ""}`, graph, "s16le");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        select ? samples : [...samples.slice(0, 4), ...samples]);
    });
  }
}

async function run(filter: string, graph: boolean, format: string, options: readonly string[] = [], bytes: Uint8Array = input): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(bytes) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), ...options, "-f", format, "/out.dat"],
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
  assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(bytes));
  return volume.readFileSync("/out.dat") as Buffer;
}
