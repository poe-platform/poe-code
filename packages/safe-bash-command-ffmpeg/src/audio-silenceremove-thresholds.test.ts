import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 8000, 0, 0, 16000, 8000, 16000, -8000, 0,
  0, 0, 0, 0, 0, -16000, 8000, 16000, 0, 0, 0, 0, 8000, -16000, 8000, 16000, 0, 0, 0, 0];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));

async function run(filter: string, graph: boolean, existingOutput = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  if (existingOutput) volume.writeFileSync("/out.raw", "keep");
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}

for (const graph of [false, true]) {
  for (const phase of ["start", "stop"]) {
    for (const [threshold, high] of [
      ["min", false], ["default", false], ["max", true],
      ["min+default", false], ["max/2", true], ["default+0", false],
      ["0", false], ["1e100", true]
    ] as const) {
      it(`resolves ${phase}_threshold=${threshold} (graph=${graph})`, async () => {
        const { result, stderr, volume } = await run(
          `silenceremove=${phase}_periods=1:window=0:${phase}_threshold=${threshold}`, graph);
        assert.equal(result.exitCode, 0, stderr);
        // Native FFmpeg 7.0.2 start-threshold output, including a real empty file for max.
        const expected = phase === "start" ? (high ? Buffer.alloc(0) : input.subarray(8))
          : (high ? input : input.subarray(0, 24));
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      });
    }
    for (const threshold of ["min-1", "max*2", "default/0", "unknown"]) {
      it(`rejects ${phase}_threshold=${threshold} without replacing output (graph=${graph})`, async () => {
        const { result, volume } = await run(
          `silenceremove=${phase}_periods=1:window=0:${phase}_threshold=${threshold}`, graph, true);
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
      });
    }
  }
}
