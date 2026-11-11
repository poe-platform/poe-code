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

// Native silenceremove integer ranges and defaults.
const options = [
  ["start_periods", 0, 9000, 0, "0"],
  ["stop_periods", -9000, 9000, 0, "0"],
  ["start_mode", 0, 1, 0, "any"],
  ["stop_mode", 0, 1, 1, "all"],
  ["detection", 0, 5, 1, "rms"],
  ["timestamp", 0, 1, 0, "write"]
] as const;

for (const graph of [false, true]) {
  for (const [key, min, max, defaultValue, named] of options) {
    for (const [value, literal] of [
      ["min", min], ["max", max], ["default", defaultValue],
      ["max-1", max - 1], ["min+1", min + 1], ["default+0", defaultValue],
      [named, defaultValue]
    ] as const) {
      it(`resolves ${key}=${value} (graph=${graph})`, async () => {
        const prefix = `silenceremove=start_periods=1:stop_periods=-1:window=0:${key}=${max}:`;
        const expected = await run(`${prefix}${key}=${literal}`, graph);
        assert.equal(expected.result.exitCode, 0, expected.stderr);
        const actual = await run(`${prefix}${key}=${value}`, graph);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.volume.readFileSync("/out.raw"), expected.volume.readFileSync("/out.raw"));
      });
    }
    for (const value of ["min-1", "max+1", "default/0", "unknown"]) {
      it(`rejects ${key}=${value} without replacing output (graph=${graph})`, async () => {
        const { result, volume } = await run(`silenceremove=${key}=${value}`, graph, true);
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
      });
    }
  }
}
